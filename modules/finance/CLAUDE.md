@../LIFEHUB_GUIDE.md

# Финансы

Учёт расходов и доходов по месяцам, категории, месячный бюджет, статистика.

## Заметки по модулю

- Коллекция `transactions`: `{ kind: "expense" | "income", amount: number, category: string, date: "YYYY-MM-DD", note?: string }`.
  Сумма всегда положительная, знак определяется `kind`. Открыта другим модулям на чтение.
- Категории хранятся в `useStore("categories")`, бюджет — в `useStore("budget")`.
