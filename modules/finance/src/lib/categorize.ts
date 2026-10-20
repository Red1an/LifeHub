import type { Kind, Rule, Tx } from "./types.ts";

/*
 * Категория по продавцу. Порядок: правила пользователя (выучены по его правкам) →
 * словарь известных продавцов → категория банка (Сбер, Т-Банк дают свою) → «Другое».
 */

/** Приводит имя продавца к виду для сравнения: KOFEMANIYA*1234 SANKT-PETERBU RUS → kofemaniya. */
export function merchantKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s+/, " ")
    .replace(/\b(sbpay|sbscr|sbp)_/g, " ")
    .replace(/_sbp\b/g, " ")
    .replace(/\b(rus|russia|moskva|moscow|sankt[- ]?peterbu\w*|spb|g\.?\s?\w+$)\b/g, " ")
    .replace(/[*#№]\s*\d+/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\b(ooo|ооо|ип|ao|ао|pao|пао|llc|zao|зао)\b/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

/** Красивое имя для показа: KOFEMANIYA*1234 → Kofemaniya. */
export function prettyMerchant(s: string): string {
  let t = s
    .replace(/^(SBPay|SBSCR|SBP)_/i, "")
    .replace(/_SBP$/i, "")
    .replace(/[*#]\s*\d+/g, "")
    .replace(/\s+(RUS|RU|Russia)\.?$/i, "")
    .replace(/\s+(MOSKVA|MOSCOW|SANKT-PETERBU\w*|G\.?\s*\S+)\s*$/i, "")
    .replace(/\s+\d{3,6}$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (t === t.toUpperCase() && /[A-ZА-Я]{4}/.test(t)) t = t.toLowerCase().replace(/(^|[\s.-])(\S)/g, (m) => m.toUpperCase());
  return t.slice(0, 60);
}

/**
 * Не продавец, а способ оплаты или посредник: «QR-оплата (СБП)», «Оплата по QR», SBPay, Restopay, CKassa…
 * Через них платят в самых разных местах, поэтому категорию по ним не запоминаем и не переносим на другие операции.
 */
const GENERIC_KEY =
  /^(\d|qr|сбп|sbp|оплата|оплата по|перевод|покупка|пополнение|списание|зачисление|внешний|внутренний|погашение|возврат|платеж|платёж|снятие|выдача|операция|payment|pay\b|restopay|ckassa|onlipay|pike|yoomoney|юmoney|ym\b|robokassa|cloudpayments|payture|tinkoff pay|sberpay|sb\b|sber|сбер|tbank|т банк|tinkoff|тинькофф|yandex pay|яндекс пэй|ozon bank|озон банк)/;

export function isGenericKey(key: string): boolean {
  return key.length < 3 || GENERIC_KEY.test(key);
}

type Dict = [RegExp, string][];

/** Известные продавцы и слова → категория. Только траты. */
const EXPENSE_DICT: Dict = [
  [/пят[её]роч|pyaterochk|перекр[её]ст|perekrestok|магнит|magnit|ашан|auchan|лента|lenta|дикси|dixy|вкусвилл|vkusvill|азбука вкуса|globus|глобус|окей|okey|spar|спар|metro c|верный|fix price|фикс прайс|самокат|samokat|лавка|lavka|чижик|светофор|мираторг|красное.?белое|krasnoe|бристоль|bristol|ozon fresh|сбермаркет|kuper|купер|market delivery|продукт|supermarket|grocery|супермаркет/, "Продукты"],
  [/yandex.?eda|яндекс.?еда|delivery club|деливери|kfc.*dostav|dodo|додо|papa john|пицц|pizza|суши|sushi|роллы|ешь деревенское|кухня на районе|vkusno.*dost|самокат.*гот/, "Доставка еды"],
  [/кофе|coffee|cofix|кофикс|шоколадниц|starbucks|кофемания|kofemaniya|surf|stars coffee|one price|кафе|cafe|caf[eé]|ресторан|restoran|restaurant|бар\b|bar\b|pub|паб|бургер|burger|вкусно и точка|vkusno|kfc|rostic|ростикс|макдон|mcdon|теремок|teremok|столов|stolov|шаурм|shaurm|чайхон|grill|гриль|блин|пекарн|bakery|хлеб|bistro|бистро|додо пицца|tanuki|тануки|якитория|coffeemania|food|фуд|eat/, "Кафе"],
  [/yandex.?go|яндекс.?go|yandex.?taxi|яндекс.?такси|uber|убер|ситимобил|citymobil|taxi maxim|такси максим|taxi|такси|wheely|vezet|везет/, "Такси"],
  [/метро|metro\b|mosmetro|мосметро|тройка|troika|подорожник|podorozhnik|транспорт|transport|автобус|mosgortrans|мосгортранс|ржд|rzd|аэроэкспресс|aeroexpress|самокат.*(whoosh|urent|юрент)|whoosh|urent|юрент|mts urent|кикшеринг|делимобиль|delimobil|belka|белкакар|yandex.?drive|каршеринг|ситидрайв|citydrive|parking|парковк/, "Транспорт"],
  [/азс|лукойл|lukoil|газпромнефть|gazpromneft|роснефть|rosneft|shell|татнефть|tatneft|bp\b|teboil|neste|автомойк|шиномонтаж|автосерв|осаго|каско|штраф гибдд|platon/, "Авто"],
  [/wildberries|вайлдберриз|\bwb\b|ozon(?!.*fresh)|озон|aliexpress|алиэкспресс|яндекс.?маркет|yandex.?market|megamarket|мегамаркет|lamoda|ламода|avito|авито|золотое яблоко|детский мир/, "Маркетплейсы"],
  [/жкх|жку|квартплат|коммунал|мосэнерго|энергосбыт|petroelektro|петроэлектро|водоканал|газпром межрегионгаз|аренда|домофон|гис жкх|epd|еирц|управляющ|leroy|леруа|obi\b|оби|икеа|ikea|hoff|хофф|castorama|касторама|домовой|petrovich|петрович/, "Дом"],
  [/мтс|mts(?!.*(urent|bank))|билайн|beeline|мегафон|megafon|tele2|теле2|yota|йота|ростелеком|rostelecom|дом\.?ру|dom\.ru|интернет|internet|tinkoff mobile|т-мобайл|сбермобайл|sbermobile|связь/, "Связь и интернет"],
  [/аптек|apteka|apteka|36[.,]6|ригла|rigla|горздрав|gorzdrav|еаптека|eapteka|здравсити|zdravcity|клиник|clinic|медцентр|стоматол|dent|invitro|инвитро|гемотест|helix|хеликс|больниц|doctor|доктор|med\b|мед\b|лаборатор/, "Здоровье"],
  [/барбер|barber|салон красот|парикмахер|маникюр|nail|beauty|бьюти|летуаль|letual|рив гош|rivegauche|золотое яблоко|косметик|spa\b|спа\b/, "Красота"],
  [/фитнес|fitness|world class|x-fit|xfit|спортмастер|sportmaster|декатлон|decathlon|бассейн|ddx|spirit|crossfit|спорт|sport|бокс|йога|yoga|скалодром/, "Спорт"],
  [/кино|cinema|кинотеатр|синема|karo|каро|формула кино|театр|theatre|theater|концерт|билет|ticket|kassir|кассир|steam|playstation|psn|xbox|nintendo|epic games|игр|game|квест|боулинг|bowling|музей|museum|парк|зоопарк|афиша|afisha/, "Развлечения"],
  [/яндекс.?плюс|yandex.?plus|plus\.yandex|кинопоиск|kinopoisk|ivi|иви|okko|окко|кион|kion|start\.ru|premier|netflix|spotify|apple\.com|itunes|google.?(one|play|storage)|youtube|icloud|vk.?(музыка|music|combo)|вк музыка|звук|zvuk|сберпрайм|sberprime|ozon premium|wb клуб|chatgpt|openai|anthropic|claude|github|notion|telegram premium|boosty|patreon|литрес|litres|bookmate|букмейт|подписк|subscription/, "Подписки"],
  [/zara|h&m|uniqlo|gloria jeans|глория|o'stin|остин|befree|love republic|lime|gj\b|bershka|pull&bear|adidas|nike|puma|reebok|new balance|befree|ecco|zenden|обувь|одежд|befree|snow queen|снежная королева|стокманн|stockmann|melon|zarina|incity/, "Одежда"],
  [/skillbox|скиллбокс|geekbrains|нетология|netology|яндекс.?практикум|practicum|stepik|coursera|udemy|skyeng|скайенг|университет|институт|guap|гуап|учеб|курс|school|школа|книг|book|читай.?город|chitai|лабиринт|labirint/, "Образование"],
  [/aviasales|авиасейлс|аэрофлот|aeroflot|s7|победа|pobeda|utair|ютэйр|уральские авиа|booking|букинг|ostrovok|островок|tutu|туту|отел|hotel|hostel|хостел|airbnb|суточно|sutochno|яндекс.?путешеств|travel/, "Путешествия"],
  [/цветы|flowers|флорист|подарк|gift/, "Подарки"],
  [/процент(ы)? по кредит|проценты за пользование|комисси|commission|плата за обслуживание|обслуживание карты|штраф за просроч|пени|неустойк|sms.?информир|смс.?информир|оповещени|страхован(ие)? (карты|кредит)/, "Проценты и комиссии"],
];

const INCOME_DICT: Dict = [
  [/зарплат|заработн|salary|аванс|оплата труда|выплата (по )?(зп|з\/п)|перечисление (заработной|зп)/, "Зарплата"],
  [/кэшбэк|кешбэк|cashback|cash back|бонус|баллы|вознагражден.* за покупки|спасибо от сбер/, "Кэшбэк и бонусы"],
  [/процент(ы)? на остаток|капитализац|начисление процентов|проценты по (вкладу|счету|счёту)|выплата процентов|доход по (вкладу|счету)/, "Проценты по вкладам"],
  [/самозанят|мой налог|фриланс|freelance|kwork|fl\.ru|профи\.ру|youdo|гонорар|оплата по договору/, "Подработка"],
];

/** Переводы между своими счетами — не траты и не доходы. */
const TRANSFER_RE =
  /между (своими )?счет|с карты на карту.*(сво|себе)|перевод себе|на свой счет|со своего счета|своему себе|погашение.{0,30}(кредит|задолж|долга)|пополнение (кредитной )?карты.*сво|внесение (на|наличн)|пополнение (сплита|split)|погашение (сплита|рассрочк|split)|оплата (сплита|рассрочки)|списание (по )?сплит|платеж по (сплиту|рассрочке|кредитной карте)|перевод с (накопительного|вклада)|на накопительный|в копилку|копилк|пополнение вклада|сбор(ы)? в (копилку|цель)|перевод на вклад|с вклада|в цели/;

/** Снятие наличных: перевод на счёт «Наличные», если он заведён, иначе — трата. */
export const CASH_RE = /снятие наличн|выдача наличн|cash withdrawal|\batm\b|банкомат/;

/** Переводы людям / от людей (СБП, по номеру телефона) — отдельные категории, не «Другое». */
const PERSON_RE = /перевод (по номеру|по сбп|через сбп|клиенту|от|для|на имя)|сбп|система быстрых платежей|перевод с карты|перевод на карту|входящий перевод|исходящий перевод|transfer/;

export interface Guess {
  kind: Kind;
  category: string;
  /** Уверенность: rule — правило пользователя, dict — словарь, bank — категория банка, none — не знаем. */
  by: "rule" | "dict" | "bank" | "person" | "none";
  toAccount?: string;
}

/** Категории Сбера/Т-Банка → наши. */
const BANK_CATS: [RegExp, string][] = [
  [/супермаркет|продукт|продовольств/i, "Продукты"],
  [/рестора|кафе|фастфуд|фаст-фуд|бары/i, "Кафе"],
  [/такси/i, "Такси"],
  [/транспорт|местный транспорт|ж\/д|аренда авто/i, "Транспорт"],
  [/топливо|азс|автоуслуги|авто/i, "Авто"],
  [/коммунал|жкх|дом и ремонт|дом, ремонт|ремонт/i, "Дом"],
  [/связь|телеком|мобильн|интернет/i, "Связь и интернет"],
  [/аптек|здоров|медицин|медуслуги/i, "Здоровье"],
  [/красот|салон/i, "Красота"],
  [/спорт/i, "Спорт"],
  [/развлеч|кино|отдых|искусство|культур/i, "Развлечения"],
  [/одежд|обувь/i, "Одежда"],
  [/образован|книг/i, "Образование"],
  [/путешеств|отел|авиабилет|турагент/i, "Путешествия"],
  [/цвет|подарк/i, "Подарки"],
  [/маркетплейс|онлайн.?магазин|интернет.?магазин|все для дома|разные товары/i, "Маркетплейсы"],
  [/комисси|проценты|плата за/i, "Проценты и комиссии"],
  [/цифров|подписк|музыка|онлайн.?кинотеатр/i, "Подписки"],
];

export function guessCategory(
  tx: Pick<Tx, "kind" | "merchant" | "note" | "raw" | "bankCategory">,
  rules: Rule[],
  known: (kind: "expense" | "income", name: string) => boolean,
): Guess {
  const text = [tx.merchant, tx.note, tx.raw].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
  const key = merchantKey(tx.merchant ?? "");
  if (key && !isGenericKey(key)) {
    // Самое длинное совпадение правила побеждает: «yandex go» точнее, чем «yandex».
    const rule = rules
      .filter((r) => r.match && !isGenericKey(r.match) && (key === r.match || key.startsWith(r.match + " ") || (r.match.length >= 5 && key.includes(r.match))))
      .sort((a, b) => b.match.length - a.match.length)[0];
    if (rule) return { kind: rule.kind ?? tx.kind, category: rule.category, by: "rule", toAccount: rule.toAccount };
  }
  if (TRANSFER_RE.test(text)) return { kind: "transfer", category: "", by: "dict" };
  // Оплата по QR через СБП — покупка, даже если в тексте «перевод №» и имя владельца договора.
  const qr = /через\s+qr|qr[- –]?код|qr-оплата/i.test(text);
  const toPerson = !qr && PERSON_TRANSFER_RE.test(text);
  const ok = (k: "expense" | "income", c: string) => known(k, c);
  if (tx.kind === "income") {
    for (const [re, cat] of INCOME_DICT) if (re.test(text) && ok("income", cat)) return { kind: "income", category: cat, by: "dict" };
    if (PERSON_RE.test(text) && ok("income", "Переводы от людей")) return { kind: "income", category: "Переводы от людей", by: "person" };
    return { kind: "income", category: ok("income", "Другое") ? "Другое" : "", by: "none" };
  }
  if (tx.kind === "expense") {
    if (!toPerson) for (const [re, cat] of EXPENSE_DICT) if (re.test(text) && ok("expense", cat)) return { kind: "expense", category: cat, by: "dict" };
    if (tx.bankCategory) for (const [re, cat] of BANK_CATS) if (re.test(tx.bankCategory) && ok("expense", cat)) return { kind: "expense", category: cat, by: "bank" };
    if (!qr && PERSON_RE.test(text) && ok("expense", "Переводы людям")) return { kind: "expense", category: "Переводы людям", by: "person" };
  }
  return { kind: tx.kind, category: ok("expense", "Другое") ? "Другое" : "", by: "none" };
}

/** Имя человека из перевода: «Перевод от Иван Иванович И.» → «Иван Иванович И.». */
export function personFromText(s: string): string | null {
  // Сбер пишет и «для П. Максим Сергеевич» (инициал фамилии впереди) — приводим к «Максим Сергеевич П.».
  const front = s.match(/(?:от|для|получатель:?|отправитель:?)\s+([А-ЯЁ])\.\s?([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/);
  if (front) return `${front[2]} ${front[1]}.`;
  const m =
    s.match(/(?:от|для|получатель:?|отправитель:?|клиенту|на имя)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.?)/) ??
    s.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)/) ??
    s.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)(?:\s|$|,)/);
  return m ? m[1].trim() : null;
}

/** Похоже на перевод конкретному человеку — словарь продавцов к такому тексту не применяем («Максим» — не такси). */
export const PERSON_TRANSFER_RE = /перевод (для|от|клиенту)|отправитель|получатель|перев[её]л/i;

/** Совпадает ли имя из банка с человеком: «Иван Иванович И.» ~ «Ваня» с алиасом «Иван И». */
export function nameMatches(bankName: string, names: string[]): boolean {
  const words = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const b = words(bankName);
  if (!b.length) return false;
  return names.some((n) => {
    const x = words(n);
    if (!x.length) return false;
    // Полные слова (имя, отчество, фамилия) одного — среди слов другого; инициалы — первые буквы его слов.
    // «Пронь Максим Сергеевич» ~ «Максим Сергеевич П.» ~ «П. Максим Сергеевич»; «Иван И.» ~ «Иван Иванович И.».
    const [short, long] = b.length <= x.length ? [b, x] : [x, b];
    const full = short.filter((w) => w.length > 1);
    const initials = short.filter((w) => w.length === 1);
    if (!full.length || !full.every((w) => long.includes(w))) return false;
    const rest = long.filter((w) => !full.includes(w));
    return initials.every((i) => rest.some((w) => w[0] === i));
  });
}
