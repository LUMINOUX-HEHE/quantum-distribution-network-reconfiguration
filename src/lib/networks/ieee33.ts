import type { NetworkDraft } from "./types";

/**
 * IEEE 33-bus radial distribution feeder.
 * Base: 12.66 kV, 10 MVA. Total load 3715 kW / 2300 kvar.
 * 32 sectionalizing branches + 5 tie branches (37-41 in the classic numbering).
 * Source: Baran & Wu (1989) / common public benchmark data.
 */

type Branch = [number, string, string, number, number];

const branches: Branch[] = [
  [1, "1", "2", 0.0922, 0.047],
  [2, "2", "3", 0.493, 0.2511],
  [3, "3", "4", 0.366, 0.1864],
  [4, "4", "5", 0.3811, 0.1941],
  [5, "5", "6", 0.819, 0.707],
  [6, "6", "7", 0.1872, 0.6188],
  [7, "7", "8", 0.7114, 0.2351],
  [8, "8", "9", 1.03, 0.74],
  [9, "9", "10", 1.044, 0.74],
  [10, "10", "11", 0.1966, 0.065],
  [11, "11", "12", 0.3744, 0.1238],
  [12, "12", "13", 1.468, 1.155],
  [13, "13", "14", 0.5416, 0.7129],
  [14, "14", "15", 0.591, 0.526],
  [15, "15", "16", 0.7463, 0.545],
  [16, "16", "17", 1.289, 1.721],
  [17, "17", "18", 0.732, 0.574],
  [18, "2", "19", 0.164, 0.1565],
  [19, "19", "20", 1.5042, 1.3554],
  [20, "20", "21", 0.4095, 0.4784],
  [21, "21", "22", 0.7089, 0.9373],
  [22, "3", "23", 0.4512, 0.3083],
  [23, "23", "24", 0.898, 0.7091],
  [24, "24", "25", 0.896, 0.7011],
  [25, "6", "26", 0.203, 0.1034],
  [26, "26", "27", 0.2842, 0.1447],
  [27, "27", "28", 1.059, 0.9337],
  [28, "28", "29", 0.8042, 0.7006],
  [29, "29", "30", 0.5075, 0.2585],
  [30, "30", "31", 0.9744, 0.963],
  [31, "31", "32", 0.3105, 0.3619],
  [32, "32", "33", 0.341, 0.5302],
];

const ties: Branch[] = [
  [33, "21", "8", 2.0, 2.0],
  [34, "9", "15", 2.0, 2.0],
  [35, "12", "22", 2.0, 2.0],
  [36, "18", "33", 0.5, 0.5],
  [37, "25", "29", 0.5, 0.5],
];

const loads: Record<string, [number, number]> = {
  "2": [100, 60],
  "3": [90, 40],
  "4": [120, 80],
  "5": [60, 30],
  "6": [60, 20],
  "7": [200, 100],
  "8": [200, 100],
  "9": [60, 20],
  "10": [60, 20],
  "11": [45, 30],
  "12": [60, 35],
  "13": [60, 35],
  "14": [120, 80],
  "15": [60, 10],
  "16": [60, 20],
  "17": [60, 20],
  "18": [90, 40],
  "19": [90, 40],
  "20": [90, 40],
  "21": [90, 40],
  "22": [90, 40],
  "23": [90, 50],
  "24": [420, 200],
  "25": [420, 200],
  "26": [60, 25],
  "27": [60, 25],
  "28": [60, 20],
  "29": [120, 70],
  "30": [200, 600],
  "31": [150, 70],
  "32": [210, 100],
  "33": [60, 40],
};

const busNames = Object.keys(loads)
  .map(Number)
  .sort((a, b) => a - b)
  .map(String);

export const IEEE33: NetworkDraft = {
  name: "IEEE 33-bus feeder",
  description:
    "Classic 33-bus, 37-branch radial distribution feeder (12.66 kV). Five tie switches give five independent loops and a 2^37 raw switch space. Literature: 202.7 kW initial loss, 139.5 kW best known after reconfiguration.",
  source: "ieee33",
  baseMva: 10,
  baseKv: 12.66,
  bestKnownLossKw: 139.55,
  bestKnownSource: "literature (Baran & Wu / common benchmark)",
  buses: [
    { name: "1", loadPkw: 0, loadQkvar: 0, kind: "slack" },
    ...busNames.map((name) => ({
      name,
      loadPkw: loads[name][0],
      loadQkvar: loads[name][1],
      kind: "pq" as const,
    })),
  ],
  lines: [
    ...branches.map(([branch, from, to, r, x]) => ({
      branch,
      from,
      to,
      rOhm: r,
      xOhm: x,
      ratingA: branch <= 8 ? 420 : 340,
      switchType: "sectionalizing" as const,
    })),
    ...ties.map(([branch, from, to, r, x]) => ({
      branch,
      from,
      to,
      rOhm: r,
      xOhm: x,
      ratingA: 300,
      switchType: "tie" as const,
      initialOpen: true,
    })),
  ],
  ders: [
    { bus: "18", kind: "pv", pKw: 260 },
    { bus: "25", kind: "pv", pKw: 320 },
    { bus: "30", kind: "pv", pKw: 300 },
    { bus: "33", kind: "wind", pKw: 180 },
  ],
};
