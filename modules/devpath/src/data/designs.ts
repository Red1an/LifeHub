import { parseDesign, type DesignTask } from "../lib/workshop-parse.ts";
import urlShortener from "../../designs/url-shortener.md";
import ticketSale from "../../designs/ticket-sale.md";
import newsFeed from "../../designs/news-feed.md";
import chat from "../../designs/chat.md";
import taxi from "../../designs/taxi.md";
import ledger from "../../designs/ledger.md";

/* Задачи System Design: ученик пишет дизайн-документ, архитектор оценивает, после — эталонный разбор. id = имя файла. */
export const DESIGNS: DesignTask[] = [
  parseDesign("url-shortener", urlShortener),
  parseDesign("ticket-sale", ticketSale),
  parseDesign("news-feed", newsFeed),
  parseDesign("chat", chat),
  parseDesign("taxi", taxi),
  parseDesign("ledger", ledger),
];

export const designById = (id: string) => DESIGNS.find((d) => d.id === id);
