import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return new Response("Invalid run id", { status: 400 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      const tick = async () => {
        try {
          const [row] = await db
            .select({
              id: runs.id,
              status: runs.status,
              stage: runs.stage,
              progress: runs.progress,
              logs: runs.logs,
              error: runs.error,
            })
            .from(runs)
            .where(eq(runs.id, runId))
            .limit(1);
          if (!row) {
            send("error", { message: "Run not found" });
            stop();
            return;
          }
          send("status", row);
          if (row.status === "completed" || row.status === "failed") stop();
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : String(error) });
          stop();
        }
      };

      void tick();
      timer = setInterval(() => {
        void tick();
      }, 800);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
