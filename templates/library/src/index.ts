/**
 * Модуль-библиотека: общий код для других модулей.
 * Подключение в другом модуле: "uses": { "__ID__": "^1" } в lifehub.json,
 * затем import { hello } from "@modules/__ID__".
 */
export function hello(name: string): string {
  return `Привет, ${name}!`;
}
