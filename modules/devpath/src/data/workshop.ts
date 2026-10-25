import { parseKata, parseMission, type Kata, type Mission } from "../lib/workshop-parse.ts";
import slowReport from "../../missions/slow-report/mission.md";
import lostKopecks from "../../missions/lost-kopecks/mission.md";
import cartDuplicates from "../../missions/cart-duplicates/mission.md";
import doubleEmails from "../../missions/double-emails/mission.md";
import slowDashboard from "../../missions/slow-dashboard/mission.md";
import lostUpdates from "../../missions/lost-updates/mission.md";
import sharedCart from "../../missions/shared-cart/mission.md";
import flakyPayments from "../../missions/flaky-payments/mission.md";
import ordersPage from "../../missions/orders-page/mission.md";
import wordTop from "../../katas/word-top/kata.md";
import mergeSlots from "../../katas/merge-slots/kata.md";
import csvLine from "../../katas/csv-line/kata.md";
import topCategory from "../../katas/top-category/kata.md";
import slugify from "../../katas/slugify/kata.md";
import paginate from "../../katas/paginate/kata.md";
import diffSettings from "../../katas/diff-settings/kata.md";
import parseDuration from "../../katas/parse-duration/kata.md";
import template from "../../katas/template/kata.md";
import lruCache from "../../katas/lru-cache/kata.md";
import tokenBucket from "../../katas/token-bucket/kata.md";
import categoryPath from "../../katas/category-path/kata.md";

/*
 * Мастерская: миссии и каты по порядку прохождения. id = имя папки (к нему привязан прогресс и рабочая папка ~/DevPath/<id>).
 * Новая миссия: папка в missions/ + строка здесь + `node server/devpath/verify.ts <id>` из корня хаба.
 */

export const MISSIONS: Mission[] = [
  parseMission("slow-report", slowReport),
  parseMission("lost-kopecks", lostKopecks),
  parseMission("cart-duplicates", cartDuplicates),
  parseMission("double-emails", doubleEmails),
  parseMission("slow-dashboard", slowDashboard),
  parseMission("lost-updates", lostUpdates),
  parseMission("shared-cart", sharedCart),
  parseMission("flaky-payments", flakyPayments),
  parseMission("orders-page", ordersPage),
];

export const KATAS: Kata[] = [
  parseKata("word-top", wordTop),
  parseKata("merge-slots", mergeSlots),
  parseKata("csv-line", csvLine),
  parseKata("top-category", topCategory),
  parseKata("slugify", slugify),
  parseKata("paginate", paginate),
  parseKata("diff-settings", diffSettings),
  parseKata("parse-duration", parseDuration),
  parseKata("template", template),
  parseKata("lru-cache", lruCache),
  parseKata("token-bucket", tokenBucket),
  parseKata("category-path", categoryPath),
];

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);
export const kataById = (id: string) => KATAS.find((k) => k.id === id);

export const LEVEL_TITLE: Record<1 | 2 | 3, string> = { 1: "Junior", 2: "Middle", 3: "Senior" };

export const KIND_TITLE: Record<Mission["kind"], { icon: string; label: string }> = {
  fix: { icon: "🔧", label: "Почини" },
  build: { icon: "➕", label: "Допиши" },
  speed: { icon: "🚀", label: "Ускорь" },
};
