package ru.lifehub.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Связь с хабом на компьютере (чистая Java — работает и в проверке на компьютере).
 *
 * После подключения по QR у телефона есть токен устройства и адреса хаба: домашняя сеть, Tailscale, ngrok.
 * Все запросы идут на <адрес>/hook/app/<токен>/<путь> — хаб пускает их без пароля и входа через Google.
 * Дорога выбирается сама: сначала домашняя сеть и Tailscale (быстрее), потом ngrok; рабочая запоминается.
 */
public final class Hub {
    public interface Listener {
        void online(boolean on);
    }

    private static final long KEEP_ROUTE_MS = 120_000;
    private static final long OFFLINE_RETRY_MS = 8_000;

    private final File file;
    private Map<String, Object> state;
    private String route;
    private long routeAt;
    private long offlineAt;
    private Boolean online;
    private Listener listener;
    /** Проверка дороги идёт в одном потоке: остальные запросы ждут её результат, а не стучатся параллельно. */
    private final Object probing = new Object();
    private final java.util.concurrent.atomic.AtomicBoolean probingSoon = new java.util.concurrent.atomic.AtomicBoolean();
    /**
     * Хаб точно отвечал только что. Пока нет — прокси не ждёт проверку, а сразу отдаёт сохранённое
     * (заметку можно записать без связи мгновенно), а дорогу проверяет в фоне.
     */
    private volatile boolean trusted;
    /** «Без связи» по требованию (проверка офлайна на компьютере, phone/android/test). */
    private volatile boolean forcedOffline;

    public Hub(File dir) {
        dir.mkdirs();
        file = new File(dir, "hub.json");
        Map<String, Object> s = null;
        try {
            s = Json.obj(Json.parse(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)));
        } catch (Exception ignored) {
        }
        state = s != null ? s : new LinkedHashMap<>();
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void setForcedOffline(boolean on) {
        forcedOffline = on;
        if (on) {
            synchronized (this) {
                route = null;
                offlineAt = System.currentTimeMillis();
            }
            setOnline(false);
        } else wake();
    }

    /** Сеть телефона изменилась (появился Wi-Fi или интернет) — проверить дорогу сразу, без паузы. */
    public synchronized void wake() {
        offlineAt = 0;
        route = null;
        trusted = false;
    }

    /** Отвечал ли хаб только что — тогда запросы идут в него, иначе сначала сохранённое. */
    public boolean trusted() {
        return trusted && !forcedOffline;
    }

    /** Проверить дорогу в фоне, не задерживая запрос (если проверка уже идёт — не дублировать). */
    public void probeSoon() {
        if (forcedOffline || !probingSoon.compareAndSet(false, true)) return;
        Thread t = new Thread(() -> {
            try {
                route();
            } finally {
                probingSoon.set(false);
            }
        }, "lifehub-probe");
        t.setDaemon(true);
        t.start();
    }

    public synchronized boolean paired() {
        return state.get("token") instanceof String;
    }

    public synchronized String deviceName() {
        return Json.str(state.get("name"), "");
    }

    /** Адреса хаба для показа: [{label, url, public}]. */
    public synchronized List<Object> bases() {
        List<Object> b = Json.arr(state.get("bases"));
        return b != null ? b : new ArrayList<>();
    }

    public synchronized String currentRoute() {
        return route;
    }

    public synchronized Boolean isOnline() {
        return online;
    }

    private synchronized void save() {
        try (OutputStream o = new FileOutputStream(file)) {
            o.write(Json.write(state).getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    /** Подключение по коду из QR: base — адрес, с которого открыли страницу. */
    public void claim(String base, String code, String name) throws IOException {
        base = base.replaceAll("/+$", "");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        Response r = send("POST", base + "/hook/app/pair/" + URLEncoder.encode(code, "UTF-8") + "/claim", json(), Json.write(body).getBytes(StandardCharsets.UTF_8), 15_000);
        Map<String, Object> j = Json.obj(Json.parse(r.text()));
        if (r.status != 200 || j == null || !(j.get("token") instanceof String)) {
            throw new IOException(j != null ? Json.str(j.get("error"), "Хаб ответил " + r.status) : "Хаб ответил " + r.status);
        }
        List<Object> bases = Json.arr(j.get("bases"));
        if (bases == null) bases = new ArrayList<>();
        // Адрес, по которому подключились, точно рабочий — пусть будет в списке.
        boolean has = false;
        for (Object o : bases) if (base.equals(Json.str(Json.obj(o).get("url"), ""))) has = true;
        if (!has) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("label", "Адрес подключения");
            b.put("url", base);
            b.put("public", base.startsWith("https://"));
            bases.add(b);
        }
        synchronized (this) {
            state.put("token", j.get("token"));
            state.put("id", j.get("id"));
            state.put("name", name);
            state.put("bases", bases);
            route = null;
        }
        save();
    }

    public synchronized void forget() {
        state = new LinkedHashMap<>();
        route = null;
        save();
    }

    private static Map<String, String> json() {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("content-type", "application/json");
        h.put("x-lifehub", "1");
        return h;
    }

    /* ───────────── выбор дороги ───────────── */

    /** Рабочий адрес вида https://…/hook/app/<токен> или null, если хаб недоступен. */
    public String route() {
        if (forcedOffline) return null;
        synchronized (this) {
            if (route != null && System.currentTimeMillis() - routeAt < KEEP_ROUTE_MS) return route;
        }
        synchronized (probing) {
            return probe();
        }
    }

    private String probe() {
        String token;
        List<String> candidates = new ArrayList<>();
        synchronized (this) {
            long now = System.currentTimeMillis();
            // Пока ждали, другой поток уже проверил.
            if (route != null && now - routeAt < KEEP_ROUTE_MS) return route;
            if (route == null && now - offlineAt < OFFLINE_RETRY_MS) return null;
            token = Json.str(state.get("token"), null);
            if (token == null) return null;
            if (route != null) candidates.add(route);
            // Сначала домашняя сеть и Tailscale, потом то, что из интернета.
            for (int pass = 0; pass < 2; pass++) {
                for (Object o : bases()) {
                    Map<String, Object> b = Json.obj(o);
                    boolean pub = Boolean.TRUE.equals(b.get("public"));
                    if ((pass == 0) == pub) continue;
                    String r = Json.str(b.get("url"), "").replaceAll("/+$", "") + "/hook/app/" + token;
                    if (!candidates.contains(r)) candidates.add(r);
                }
            }
        }
        // Все адреса сразу, а не по очереди: без связи ответ «недоступен» — за несколько секунд, а не за сумму таймаутов.
        // Побеждает первый ответивший — обычно это домашняя сеть, она и быстрее.
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(Math.max(1, candidates.size()));
        java.util.concurrent.CompletionService<Object[]> done = new java.util.concurrent.ExecutorCompletionService<>(pool);
        for (String r : candidates) {
            done.submit(() -> {
                try {
                    return new Object[]{r, send("GET", r + "/api/app/info", null, null, r.startsWith("https://") ? 6000 : 2500).status};
                } catch (IOException e) {
                    return new Object[]{r, 0};
                }
            });
        }
        try {
            for (int i = 0; i < candidates.size(); i++) {
                Object[] res = done.take().get();
                int status = (Integer) res[1];
                if (status == 401) {
                    setOnline(false);
                    return null;
                }
                if (status == 200) {
                    synchronized (this) {
                        route = (String) res[0];
                        routeAt = System.currentTimeMillis();
                    }
                    trusted = true;
                    setOnline(true);
                    return route;
                }
            }
        } catch (Exception ignored) {
        } finally {
            pool.shutdownNow();
        }
        synchronized (this) {
            route = null;
            offlineAt = System.currentTimeMillis();
        }
        trusted = false;
        setOnline(false);
        return null;
    }

    /**
     * Запрос по текущей дороге не прошёл — следующий запрос сначала проверит хаб заново.
     * «Без связи» здесь не ставится: один оборванный запрос (поток событий, медленный ответ, смена сети)
     * ещё не значит, что компьютер недоступен. Решает только проверка в route().
     */
    public synchronized void failed() {
        route = null;
        trusted = false;
    }

    /** Запрос прошёл — дорога рабочая ещё какое-то время. */
    public synchronized void succeeded() {
        if (route != null) routeAt = System.currentTimeMillis();
        trusted = true;
        setOnline(true);
    }

    private void setOnline(boolean on) {
        Listener l;
        synchronized (this) {
            if (online != null && online == on) return;
            online = on;
            l = listener;
        }
        if (l != null) l.online(on);
    }

    /* ───────────── запросы ───────────── */

    public static final class Response {
        public int status;
        public Map<String, String> headers = new LinkedHashMap<>();
        public byte[] body;
        /** Для потоковых ответов (события) — тело не прочитано, читать отсюда. */
        public InputStream stream;
        public HttpURLConnection conn;

        public String text() {
            return body == null ? "" : new String(body, StandardCharsets.UTF_8);
        }

        public String header(String name) {
            return headers.get(name.toLowerCase());
        }
    }

    /** Запрос к хабу по рабочей дороге: путь вида /api/… Без дороги — IOException. */
    public Response call(String method, String path, Map<String, String> headers, byte[] body) throws IOException {
        // Чтение можно безопасно повторить: дорога могла смениться (Wi-Fi → мобильный), хаб при этом жив.
        boolean retry = "GET".equals(method) || "HEAD".equals(method);
        for (int attempt = 0; ; attempt++) {
            String r = route();
            if (r == null) throw new IOException("Нет связи с хабом");
            try {
                Response res = send(method, r + path, headers, body, 60_000);
                if (offline(res)) throw new IOException("Хаб недоступен (" + res.status + ")");
                succeeded();
                return res;
            } catch (SocketTimeoutException e) {
                // Соединение было, хаб просто долго думает (Claude, поиск в интернете) — связь не рвём.
                if (e.getMessage() == null || !e.getMessage().toLowerCase().contains("connect")) throw e;
                failed();
                if (!retry || attempt > 0) throw e;
            } catch (IOException e) {
                failed();
                if (!retry || attempt > 0) throw e;
            }
        }
    }

    /** Ответ значит «до компьютера не достучались»: ngrok/Tailscale ответили вместо хаба. */
    static boolean offline(Response r) {
        return r.status == 502 || r.status == 503 || r.status == 504 || r.header("ngrok-error-code") != null;
    }

    public Response open(String method, String path, Map<String, String> headers) throws IOException {
        String r = route();
        if (r == null) throw new IOException("Нет связи с хабом");
        HttpURLConnection c = connect(method, r + path, headers, 15_000);
        // Хаб шлёт ping каждые 25 с: тишина дольше минуты — соединение умерло (сменилась сеть), пусть переподключится.
        c.setReadTimeout(60_000);
        Response res = new Response();
        res.status = c.getResponseCode();
        readHeaders(c, res);
        if (offline(res)) {
            c.disconnect();
            failed();
            throw new IOException("Хаб недоступен (" + res.status + ")");
        }
        res.stream = res.status >= 400 ? c.getErrorStream() : c.getInputStream();
        res.conn = c;
        succeeded();
        return res;
    }

    private static HttpURLConnection connect(String method, String url, Map<String, String> headers, int timeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(Math.min(timeout, 8000));
        c.setReadTimeout(timeout);
        c.setUseCaches(false);
        if ("PATCH".equals(method)) {
            // HttpURLConnection не знает PATCH — хаб понимает подмену.
            c.setRequestMethod("POST");
            c.setRequestProperty("x-http-method-override", "PATCH");
        } else c.setRequestMethod(method);
        if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
        c.setRequestProperty("accept-encoding", "identity");
        c.setRequestProperty("ngrok-skip-browser-warning", "1");
        return c;
    }

    private static void readHeaders(HttpURLConnection c, Response res) {
        for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
            if (h.getKey() != null && !h.getValue().isEmpty()) res.headers.put(h.getKey().toLowerCase(), h.getValue().get(0));
        }
    }

    static Response send(String method, String url, Map<String, String> headers, byte[] body, int timeout) throws IOException {
        HttpURLConnection c = connect(method, url, headers, timeout);
        try {
            if (body != null) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream o = c.getOutputStream()) {
                    o.write(body);
                }
            }
            Response res = new Response();
            res.status = c.getResponseCode();
            readHeaders(c, res);
            InputStream in = res.status >= 400 ? c.getErrorStream() : c.getInputStream();
            res.body = in == null ? new byte[0] : readAll(in);
            return res;
        } finally {
            c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in; ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
            byte[] b = new byte[16384];
            for (int n; (n = i.read(b)) > 0; ) buf.write(b, 0, n);
            return buf.toByteArray();
        }
    }
}
