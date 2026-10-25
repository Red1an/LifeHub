package ru.lifehub.app;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Хаб внутри приложения: WebView открывает http://127.0.0.1:<порт>, а прокси пересылает запросы в хаб (Hub)
 * и сохраняет ответы на телефоне. Без связи:
 *  - страницы, скрипты модулей, данные и найденное в интернете (аккорды и т. п.) — из сохранённого;
 *  - записи в данные модулей (/api/data, /api/kv) применяются к сохранённому и ждут в очереди,
 *    а когда хаб снова доступен — уходят в него по порядку (кто последний, тот и прав).
 * Чистая Java: проверяется на компьютере (phone/android/test/ProxyCheck.java).
 */
public final class Proxy {
    public interface Listener {
        /** Очередь записей отправлена — пусть интерфейс перечитает данные. */
        void synced();
    }

    private static final Pattern DATA = Pattern.compile("^/api/data/([^/?]+)/([^/?]+)(?:/([^/?]+))?$");
    private static final Pattern KV = Pattern.compile("^/api/kv/([^/?]+)/([^/?]+)$");
    private static final String[] SKIP_REQUEST = {"host", "connection", "accept-encoding", "content-length", "cookie", "origin", "referer"};
    private static final String[] PASS_RESPONSE = {"content-type", "cache-control", "content-disposition", "etag", "last-modified"};

    private final Hub hub;
    private final File cacheDir;
    private final File queueFile;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private Listener listener;
    private ServerSocket server;
    private final Object queueLock = new Object();

    public Proxy(Hub hub, File dir) {
        this.hub = hub;
        this.cacheDir = new File(dir, "cache");
        this.queueFile = new File(dir, "queue.json");
        cacheDir.mkdirs();
    }

    public void setListener(Listener l) {
        listener = l;
    }

    /** Запускает прокси на свободном порту (только для этого устройства) и возвращает порт. */
    public synchronized int start() throws IOException {
        if (server != null) return server.getLocalPort();
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket s = server.accept();
                    pool.execute(() -> serve(s));
                } catch (IOException ignored) {
                }
            }
        }, "lifehub-proxy");
        t.setDaemon(true);
        t.start();
        Thread sync = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Thread.sleep(15_000);
                    if (queued() > 0) replay();
                } catch (InterruptedException e) {
                    return;
                }
            }
        }, "lifehub-sync");
        sync.setDaemon(true);
        sync.start();
        return server.getLocalPort();
    }

    /* ───────────── HTTP ───────────── */

    private static final class Req {
        String method;
        String target;
        String path;
        Map<String, String> headers = new LinkedHashMap<>();
        byte[] body;
    }

    private void serve(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(30_000);
            InputStream in = sock.getInputStream();
            OutputStream out = new BufferedOutputStream(sock.getOutputStream());
            Req r = read(in);
            if (r == null) return;
            handle(r, out);
            out.flush();
        } catch (Exception ignored) {
        }
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        for (int c; (c = in.read()) >= 0; ) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
        }
        return b.toString("UTF-8");
    }

    private static Req read(InputStream in) throws IOException {
        String first = line(in);
        String[] p = first.split(" ");
        if (p.length < 2) return null;
        Req r = new Req();
        r.method = p[0].toUpperCase(Locale.ROOT);
        r.target = p[1];
        int q = r.target.indexOf('?');
        r.path = q >= 0 ? r.target.substring(0, q) : r.target;
        for (String l; !(l = line(in)).isEmpty(); ) {
            int c = l.indexOf(':');
            if (c > 0) r.headers.put(l.substring(0, c).trim().toLowerCase(Locale.ROOT), l.substring(c + 1).trim());
        }
        int len = 0;
        try {
            len = Integer.parseInt(r.headers.getOrDefault("content-length", "0"));
        } catch (NumberFormatException ignored) {
        }
        r.body = new byte[len];
        for (int off = 0; off < len; ) {
            int n = in.read(r.body, off, len - off);
            if (n < 0) break;
            off += n;
        }
        return r;
    }

    private static void respond(OutputStream out, int status, Map<String, String> headers, byte[] body) throws IOException {
        StringBuilder h = new StringBuilder("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
        for (Map.Entry<String, String> e : headers.entrySet()) h.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        h.append("content-length: ").append(body.length).append("\r\nconnection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
    }

    private static String reason(int s) {
        switch (s) {
            case 200: return "OK";
            case 302: return "Found";
            case 401: return "Unauthorized";
            case 404: return "Not Found";
            case 503: return "Service Unavailable";
            default: return "Status";
        }
    }

    private static Map<String, String> type(String t) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("content-type", t);
        h.put("cache-control", "no-store");
        return h;
    }

    private static void json(OutputStream out, int status, Object v) throws IOException {
        respond(out, status, type("application/json; charset=utf-8"), Json.write(v).getBytes(StandardCharsets.UTF_8));
    }

    private static Map<String, Object> error(String text) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", text);
        return m;
    }

    /* ───────────── маршрутизация ───────────── */

    private void handle(Req r, OutputStream out) throws IOException {
        Map<String, String> fwd = new LinkedHashMap<>();
        for (Map.Entry<String, String> h : r.headers.entrySet()) {
            boolean skip = false;
            for (String x : SKIP_REQUEST) if (x.equals(h.getKey())) skip = true;
            if (!skip) fwd.put(h.getKey(), h.getValue());
        }
        // Свой service worker хаба в приложении не нужен: офлайн здесь делает прокси.
        if (r.path.equals("/sw.js")) {
            respond(out, 200, type("text/javascript"), "self.addEventListener('install',()=>self.skipWaiting());".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (r.path.equals("/api/events")) {
            events(r, fwd, out);
            return;
        }
        boolean get = r.method.equals("GET") || r.method.equals("HEAD");
        // Хаб не подтвердил, что доступен (только открыли приложение, сменилась сеть, был обрыв) — не ждём проверку
        // дорог: сразу сохранённое и запись в очередь, а проверка идёт в фоне. Вернётся связь — страница перечитает
        // данные сама (событие reconnected в sdk/core.ts), очередь уйдёт в хаб.
        if (!hub.trusted()) {
            hub.probeSoon();
            if (cachedAnswer(r, out)) return;
            if (!get && isData(r.path)) {
                offlineWrite(r, out);
                return;
            }
        }
        // Пока в очереди есть записи, новые встают за ними — иначе порядок нарушится.
        if (!get && isData(r.path) && queued() > 0 && !replay()) {
            offlineWrite(r, out);
            return;
        }
        Hub.Response res;
        try {
            res = hub.call(r.method, r.target, fwd, get ? null : r.body);
        } catch (IOException e) {
            offline(r, out);
            return;
        }
        if (res.status == 200) {
            store(r, res);
            if (!get) remember(r, res);
        }
        Map<String, String> h = new LinkedHashMap<>();
        for (String k : PASS_RESPONSE) if (res.header(k) != null) h.put(k, res.header(k));
        if (res.header("location") != null) h.put("location", res.header("location"));
        respond(out, res.status, h, r.method.equals("HEAD") ? new byte[0] : res.body);
    }

    private static boolean isData(String path) {
        return DATA.matcher(path).matches() || KV.matcher(path).matches();
    }

    /**
     * Поток событий хаба (SSE). Без связи поток не обрывается ошибкой (EventSource после ошибочного ответа
     * больше не переподключается), а ждёт хаб: странице сразу уходит своё «hello», а когда хаб ответит, его «hello»
     * станет для неё переподключением — и она перечитает данные, показанные из сохранённого.
     */
    private void events(Req r, Map<String, String> fwd, OutputStream out) throws IOException {
        Hub.Response res = null;
        if (hub.trusted()) {
            try {
                res = hub.open("GET", r.target, fwd);
            } catch (IOException ignored) {
            }
        }
        if (res != null) {
            out.write(("HTTP/1.1 " + res.status + " OK\r\ncontent-type: " + (res.header("content-type") != null ? res.header("content-type") : "text/event-stream")
                    + "\r\ncache-control: no-store\r\nconnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        } else {
            out.write("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-store\r\nconnection: close\r\n\r\nevent: hello\ndata: {}\n\n"
                    .getBytes(StandardCharsets.UTF_8));
            out.flush();
            while (res == null) {
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException e) {
                    return;
                }
                // Комментарий SSE: если страница закрыла поток, запись упадёт — и ждать некого.
                out.write(": wait\n\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
                if (hub.route() == null) continue;
                try {
                    res = hub.open("GET", r.target, fwd);
                } catch (IOException ignored) {
                }
            }
            if (queued() > 0) replay();
        }
        // Поток закрывается постоянно: страница перезагрузилась, приложение ушло в фон, туннель оборвал долгое
        // соединение. Это не «компьютер недоступен» — пусть страница переподключится, а дорогу проверит route().
        try (InputStream in = res.stream) {
            byte[] b = new byte[4096];
            while (true) {
                int n;
                try {
                    n = in == null ? -1 : in.read(b);
                } catch (IOException e) {
                    hub.failed();
                    break;
                }
                if (n <= 0) break;
                out.write(b, 0, n);
                out.flush();
            }
        } catch (IOException ignored) {
            // Страница сама закрыла поток.
        } finally {
            res.conn.disconnect();
        }
        // Связь вернулась после обрыва — заодно отправим накопленное.
        if (queued() > 0) replay();
    }

    /* ───────────── сохранённое ───────────── */

    private static String sha1(String s) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-1");
            StringBuilder b = new StringBuilder();
            for (byte x : d.digest(s.getBytes(StandardCharsets.UTF_8))) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** Ключ сохранённого ответа; запросы в интернет через хаб — по телу (адрес страницы). */
    private static String key(Req r) {
        if (r.method.equals("POST") && r.path.startsWith("/api/net/")) return "NET " + r.path + " " + new String(r.body, StandardCharsets.UTF_8);
        if (isPage(r.path)) return "PAGE";
        return r.target;
    }

    /** Страница интерфейса (любой адрес хаба, кроме API и файлов) — у них одна и та же HTML-оболочка. */
    private static boolean isPage(String path) {
        if (path.startsWith("/api/") || path.startsWith("/modules/") || path.startsWith("/s/")) return false;
        String last = path.substring(path.lastIndexOf('/') + 1);
        return !last.contains(".");
    }

    private static boolean cacheable(Req r) {
        if (r.method.equals("GET")) return !r.path.startsWith("/api/app/") && !r.path.startsWith("/api/system") && !r.path.startsWith("/api/hooks/");
        return r.method.equals("POST") && r.path.startsWith("/api/net/");
    }

    private void store(Req r, Hub.Response res) {
        if (!cacheable(r)) return;
        put(key(r), res.header("content-type"), res.body);
    }

    private void put(String key, String type, byte[] body) {
        String name = sha1(key);
        try {
            File tmp = new File(cacheDir, name + ".tmp");
            try (OutputStream o = new FileOutputStream(tmp)) {
                o.write(body);
            }
            File dst = new File(cacheDir, name);
            if (!tmp.renameTo(dst)) {
                dst.delete();
                tmp.renameTo(dst);
            }
            Files.write(new File(cacheDir, name + ".type").toPath(), (type == null ? "application/octet-stream" : type).getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    private byte[] get(String key) {
        try {
            return Files.readAllBytes(new File(cacheDir, sha1(key)).toPath());
        } catch (IOException e) {
            return null;
        }
    }

    private String typeOf(String key) {
        try {
            return new String(Files.readAllBytes(new File(cacheDir, sha1(key) + ".type").toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "application/octet-stream";
        }
    }

    public long cacheBytes() {
        long n = 0;
        File[] files = cacheDir.listFiles();
        if (files != null) for (File f : files) n += f.length();
        return n;
    }

    /** Без связи: GET и поиск в интернете — из сохранённого, записи в данные — в очередь, остальное — ошибка. */
    /** Ответить сохранённым (или собранным из сохранённого), если оно есть. */
    private boolean cachedAnswer(Req r, OutputStream out) throws IOException {
        if (!r.method.equals("GET") && !(r.method.equals("POST") && r.path.startsWith("/api/net/"))) return false;
        String k = key(r);
        byte[] body = get(k);
        String t = body != null ? typeOf(k) : "application/json; charset=utf-8";
        if (body == null && r.method.equals("GET")) body = derived(r.path);
        if (body == null) return false;
        Map<String, String> h = type(t);
        h.put("x-lifehub-offline", "1");
        respond(out, 200, h, body);
        return true;
    }

    private void offline(Req r, OutputStream out) throws IOException {
        if (r.method.equals("GET") || (r.method.equals("POST") && r.path.startsWith("/api/net/"))) {
            if (cachedAnswer(r, out)) return;
            if (isPage(r.path)) {
                respond(out, 503, type("text/html; charset=utf-8"), OFFLINE_PAGE.getBytes(StandardCharsets.UTF_8));
                return;
            }
            json(out, 503, error("Нет связи с хабом, и это ещё не открывалось на телефоне"));
            return;
        }
        if (isData(r.path)) {
            offlineWrite(r, out);
            return;
        }
        json(out, 503, error("Нет связи с хабом — это работает, только когда компьютер доступен"));
    }

    /**
     * Чего нет в сохранённом, но можно собрать: ключ — из всех ключей модуля, документ — из списка коллекции,
     * пустая коллекция модуля, который сохранён целиком (у пустых коллекций в хабе нет записей — их нет и в списке).
     */
    private byte[] derived(String path) {
        Matcher kv = KV.matcher(path);
        if (kv.matches()) {
            byte[] all = get("/api/kv/" + kv.group(1));
            if (all == null) return null;
            try {
                Map<String, Object> map = Json.obj(Json.parse(new String(all, StandardCharsets.UTF_8)));
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("value", map != null && map.containsKey(kv.group(2)) ? map.get(kv.group(2)) : Json.NULL);
                return Json.write(one).getBytes(StandardCharsets.UTF_8);
            } catch (Exception e) {
                return null;
            }
        }
        Matcher m = DATA.matcher(path);
        if (!m.matches()) return null;
        if (m.group(3) == null) return get("/api/kv/" + m.group(1)) != null ? "[]".getBytes(StandardCharsets.UTF_8) : null;
        for (Object o : list(listPath(m))) {
            Map<String, Object> d = Json.obj(o);
            if (d != null && m.group(3).equals(d.get("id"))) return Json.write(d).getBytes(StandardCharsets.UTF_8);
        }
        return null;
    }

    private static final String OFFLINE_PAGE = "<!doctype html><html lang=ru><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#1d1210;color:#f6e3da;font:16px system-ui'>"
            + "<div style='max-width:320px;text-align:center;padding:16px'><h2>Нет связи с хабом</h2>"
            + "<p style='color:#c9a99c'>Эта страница ещё не открывалась на телефоне. Когда компьютер будет доступен, откройте её один раз — и она будет работать без связи.</p>"
            + "<p><a style='color:#ffb7a2' href='/'>На главную</a></p></div></body></html>";

    /** Запись прошла в хаб — поправить и сохранённое, чтобы без связи было видно последнее. */
    private void remember(Req r, Hub.Response res) {
        Matcher m = DATA.matcher(r.path);
        Matcher kv = KV.matcher(r.path);
        try {
            synchronized (queueLock) {
                if (m.matches()) {
                    String lp = listPath(m);
                    if (get(lp) == null) return;
                    List<Object> items = list(lp);
                    String sub = m.group(3);
                    Object answer = Json.parse(res.text());
                    if (sub == null && r.method.equals("POST")) items.add(answer);
                    else if (sub == null && r.method.equals("DELETE")) items.clear();
                    else if ("batch".equals(sub)) {
                        Map<String, Object> a = Json.obj(answer);
                        Map<String, Object> b = Json.obj(Json.parse(new String(r.body, StandardCharsets.UTF_8)));
                        for (String part : new String[]{"added", "updated"}) {
                            List<Object> docs = a != null ? Json.arr(a.get(part)) : null;
                            if (docs != null) for (Object d : docs) upsert(items, Json.obj(d));
                        }
                        List<Object> rem = b != null ? Json.arr(b.get("remove")) : null;
                        if (rem != null) for (Object id : rem) {
                            int i = indexOf(items, Json.str(id, ""));
                            if (i >= 0) items.remove(i);
                        }
                    } else if (r.method.equals("DELETE")) {
                        int i = indexOf(items, sub);
                        if (i >= 0) items.remove(i);
                    } else upsert(items, Json.obj(answer));
                    saveList(lp, items);
                } else if (kv.matches() && r.method.equals("PUT")) {
                    put(r.path, "application/json; charset=utf-8", r.body);
                    String all = "/api/kv/" + kv.group(1);
                    byte[] cached = get(all);
                    Map<String, Object> map = cached != null ? Json.obj(Json.parse(new String(cached, StandardCharsets.UTF_8))) : null;
                    Map<String, Object> one = Json.obj(Json.parse(new String(r.body, StandardCharsets.UTF_8)));
                    if (map != null && one != null) {
                        map.put(kv.group(2), one.get("value"));
                        put(all, "application/json; charset=utf-8", Json.write(map).getBytes(StandardCharsets.UTF_8));
                    }
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static void upsert(List<Object> items, Map<String, Object> d) {
        if (d == null || !(d.get("id") instanceof String)) return;
        int i = indexOf(items, (String) d.get("id"));
        if (i >= 0) items.set(i, d);
        else items.add(d);
    }

    /* ───────────── записи без связи ───────────── */

    private static String listPath(Matcher m) {
        return "/api/data/" + m.group(1) + "/" + m.group(2);
    }

    private List<Object> list(String path) {
        byte[] b = get(path);
        if (b == null) return new ArrayList<>();
        try {
            List<Object> a = Json.arr(Json.parse(new String(b, StandardCharsets.UTF_8)));
            return a != null ? a : new ArrayList<>();
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private void saveList(String path, List<Object> items) {
        put(path, "application/json; charset=utf-8", Json.write(items).getBytes(StandardCharsets.UTF_8));
    }

    private static String newId() {
        StringBuilder b = new StringBuilder(Long.toString(System.currentTimeMillis(), 36));
        for (int i = 0; i < 10; i++) b.append(Integer.toHexString((int) (Math.random() * 16)));
        return b.toString();
    }

    private static Map<String, Object> doc(Map<String, Object> data, String id, Object createdAt) {
        Map<String, Object> d = new LinkedHashMap<>();
        if (data != null) d.putAll(data);
        d.remove("id");
        d.remove("createdAt");
        d.remove("updatedAt");
        long now = System.currentTimeMillis();
        d.put("id", id);
        d.put("createdAt", createdAt != null ? createdAt : now);
        d.put("updatedAt", now);
        return d;
    }

    private static int indexOf(List<Object> items, String id) {
        for (int i = 0; i < items.size(); i++) {
            Map<String, Object> d = Json.obj(items.get(i));
            if (d != null && id.equals(d.get("id"))) return i;
        }
        return -1;
    }

    /** Применить запись к сохранённому, поставить в очередь и ответить так, как ответил бы хаб. */
    private void offlineWrite(Req r, OutputStream out) throws IOException {
        Object body;
        try {
            body = r.body.length > 0 ? Json.parse(new String(r.body, StandardCharsets.UTF_8)) : null;
        } catch (Exception e) {
            json(out, 400, error("Непонятный запрос"));
            return;
        }
        Object result;
        List<Object[]> ops = new ArrayList<>();
        synchronized (queueLock) {
            Matcher m = DATA.matcher(r.path);
            Matcher kv = KV.matcher(r.path);
            if (m.matches()) {
                String lp = listPath(m);
                List<Object> items = list(lp);
                String sub = m.group(3);
                if (sub == null && r.method.equals("POST")) {
                    Map<String, Object> d = doc(Json.obj(body), newId(), null);
                    items.add(d);
                    ops.add(new Object[]{"PUT", lp + "/" + d.get("id"), d});
                    result = d;
                } else if (sub == null && r.method.equals("DELETE")) {
                    items.clear();
                    ops.add(new Object[]{"DELETE", lp, null});
                    result = okResult();
                } else if ("batch".equals(sub) && r.method.equals("POST")) {
                    result = batch(lp, items, Json.obj(body), ops);
                } else if (sub != null && (r.method.equals("PUT") || r.method.equals("PATCH"))) {
                    int i = indexOf(items, sub);
                    Map<String, Object> old = i >= 0 ? Json.obj(items.get(i)) : null;
                    Map<String, Object> merged = new LinkedHashMap<>();
                    if (r.method.equals("PATCH") && old != null) merged.putAll(old);
                    Map<String, Object> patch = Json.obj(body);
                    if (patch != null) merged.putAll(patch);
                    Map<String, Object> d = doc(merged, sub, old != null ? old.get("createdAt") : null);
                    if (i >= 0) items.set(i, d);
                    else items.add(d);
                    ops.add(new Object[]{r.method, lp + "/" + sub, patch});
                    result = d;
                } else if (sub != null && r.method.equals("DELETE")) {
                    int i = indexOf(items, sub);
                    if (i >= 0) items.remove(i);
                    ops.add(new Object[]{"DELETE", lp + "/" + sub, null});
                    result = okResult();
                } else {
                    json(out, 503, error("Нет связи с хабом"));
                    return;
                }
                saveList(lp, items);
            } else if (kv.matches() && r.method.equals("PUT")) {
                Map<String, Object> b = Json.obj(body);
                Object value = b != null ? b.get("value") : Json.NULL;
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("value", value);
                put(r.path, "application/json; charset=utf-8", Json.write(one).getBytes(StandardCharsets.UTF_8));
                // Все ключи модуля одним запросом — тоже обновить.
                String all = "/api/kv/" + kv.group(1);
                byte[] cached = get(all);
                Map<String, Object> map = null;
                try {
                    map = cached != null ? Json.obj(Json.parse(new String(cached, StandardCharsets.UTF_8))) : null;
                } catch (Exception ignored) {
                }
                if (map != null) {
                    map.put(kv.group(2), value);
                    put(all, "application/json; charset=utf-8", Json.write(map).getBytes(StandardCharsets.UTF_8));
                }
                ops.add(new Object[]{"PUT", r.path, one});
                result = okResult();
            } else {
                json(out, 503, error("Нет связи с хабом"));
                return;
            }
            List<Object> q = queue();
            for (Object[] op : ops) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("method", op[0]);
                e.put("path", op[1]);
                e.put("body", op[2] == null ? Json.NULL : op[2]);
                q.add(e);
            }
            saveQueue(q);
        }
        Map<String, String> h = type("application/json; charset=utf-8");
        h.put("x-lifehub-offline", "1");
        respond(out, 200, h, Json.write(result).getBytes(StandardCharsets.UTF_8));
    }

    private static Map<String, Object> okResult() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        return m;
    }

    private Map<String, Object> batch(String lp, List<Object> items, Map<String, Object> body, List<Object[]> ops) {
        List<Object> added = new ArrayList<>();
        List<Object> updated = new ArrayList<>();
        if (body != null) {
            List<Object> add = Json.arr(body.get("add"));
            if (add != null) for (Object o : add) {
                Map<String, Object> d = doc(Json.obj(o), newId(), null);
                items.add(d);
                added.add(d);
                ops.add(new Object[]{"PUT", lp + "/" + d.get("id"), d});
            }
            List<Object> upd = Json.arr(body.get("update"));
            if (upd != null) for (Object o : upd) {
                Map<String, Object> u = Json.obj(o);
                if (u == null) continue;
                String id = Json.str(u.get("id"), "");
                int i = indexOf(items, id);
                if (i < 0) continue;
                Map<String, Object> merged = new LinkedHashMap<>(Json.obj(items.get(i)));
                Map<String, Object> patch = Json.obj(u.get("patch"));
                if (patch != null) merged.putAll(patch);
                Map<String, Object> d = doc(merged, id, merged.get("createdAt"));
                items.set(i, d);
                updated.add(d);
                ops.add(new Object[]{"PATCH", lp + "/" + id, patch});
            }
            List<Object> rem = Json.arr(body.get("remove"));
            if (rem != null) for (Object o : rem) {
                String id = Json.str(o, "");
                int i = indexOf(items, id);
                if (i >= 0) items.remove(i);
                ops.add(new Object[]{"DELETE", lp + "/" + id, null});
            }
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("added", added);
        res.put("updated", updated);
        return res;
    }

    private List<Object> queue() {
        try {
            List<Object> q = Json.arr(Json.parse(new String(Files.readAllBytes(queueFile.toPath()), StandardCharsets.UTF_8)));
            return q != null ? q : new ArrayList<>();
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private void saveQueue(List<Object> q) {
        try {
            Files.write(queueFile.toPath(), Json.write(q).getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    public int queued() {
        synchronized (queueLock) {
            return queue().size();
        }
    }

    /** Отправить очередь в хаб. true — всё ушло. */
    public boolean replay() {
        boolean sent = false;
        synchronized (queueLock) {
            List<Object> q = queue();
            if (q.isEmpty()) return true;
            Map<String, String> h = new LinkedHashMap<>();
            h.put("content-type", "application/json");
            h.put("x-lifehub", "1");
            while (!q.isEmpty()) {
                Map<String, Object> e = Json.obj(q.get(0));
                String method = Json.str(e.get("method"), "PUT");
                Object body = e.get("body");
                try {
                    Hub.Response res = hub.call(method, Json.str(e.get("path"), "/"), h,
                            body == null || body == Json.NULL ? null : Json.write(body).getBytes(StandardCharsets.UTF_8));
                    // 4xx — хаб такое не примет никогда (модуль удалён, неверные данные): выбрасываем.
                    if (res.status >= 500) break;
                } catch (IOException ex) {
                    break;
                }
                q.remove(0);
                saveQueue(q);
                sent = true;
            }
            if (!q.isEmpty()) return false;
        }
        if (sent && listener != null) listener.synced();
        return true;
    }

    /* ───────────── заранее сохранить (фоновая задача) ───────────── */

    /**
     * Скачать заранее то, что должно открываться без связи, даже если давно не открывалось:
     * оболочку, скрипты всех модулей и данные из списка (например, песни «Гитары»).
     */
    public void warm(List<String> paths) {
        for (String p : paths) {
            Req r = new Req();
            r.method = "GET";
            r.target = p;
            int q = p.indexOf('?');
            r.path = q >= 0 ? p.substring(0, q) : p;
            try {
                Hub.Response res = hub.call("GET", p, null, null);
                if (res.status == 200) store(r, res);
            } catch (IOException e) {
                return;
            }
        }
    }

    /** Сохранённый ответ (для фоновой задачи: состояние хаба со списком модулей). */
    public String cached(String path) {
        byte[] b = get(path);
        return b == null ? null : new String(b, StandardCharsets.UTF_8);
    }
}
