# Чужие корзины

Условие, подсказки и разбор — в DevPath (Мастерская). Здесь только код.

- Код — `src/CartApi/` (`Program.cs` — настройка сервисов, `Cart.cs` — корзина).
- Тесты — `tests/`. Их кладёт хаб и обновляет перед каждой проверкой.
- Проверить: кнопка «Проверить» в DevPath или `dotnet test` в этой папке.
- Запустить руками: `dotnet run --project src/CartApi`, потом, например,
  `curl -X POST -H "X-User: anna" http://localhost:5000/cart/coffee`.
