package ru.lifehub.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;

/**
 * Состояние «Фокуса» на телефоне: настройки из хаба, идущие сеансы, журнал за неделю и очередь на отправку.
 * Логика та же, что у расширения браузера (voice/browser-extension/focus/focus.js) — менять вместе.
 * Формат настроек — modules/focus/src/lib/types.ts.
 */
final class Store {
    /** Встроенные сайты → приложения Android: для настроек, где у сайта ещё нет поля apps. */
    static final String[][] APPS = {
            {"youtube", "com.google.android.youtube", "app.revanced.android.youtube", "app.rvx.android.youtube"},
            {"instagram", "com.instagram.android", "com.instagram.lite"},
            {"vk", "com.vkontakte.android"},
            {"tiktok", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill"},
            {"ozon", "ru.ozon.app.android"},
            {"wildberries", "com.wildberries.ru"},
    };

    static final String DEFAULTS = "{\"enabled\":true,\"sites\":["
            + "{\"id\":\"youtube\",\"name\":\"YouTube\",\"hosts\":[\"youtube.com\"],\"on\":true,\"clean\":true,\"dailyMin\":60},"
            + "{\"id\":\"instagram\",\"name\":\"Инстаграм\",\"hosts\":[\"instagram.com\"],\"on\":true,\"clean\":true,\"dailyMin\":30},"
            + "{\"id\":\"ozon\",\"name\":\"Озон\",\"hosts\":[\"ozon.ru\"],\"on\":true,\"clean\":false,\"dailyMin\":20},"
            + "{\"id\":\"wildberries\",\"name\":\"Wildberries\",\"hosts\":[\"wildberries.ru\",\"wb.ru\"],\"on\":true,\"clean\":false,\"dailyMin\":20},"
            + "{\"id\":\"vk\",\"name\":\"ВКонтакте\",\"hosts\":[\"vk.com\"],\"on\":false,\"clean\":false,\"dailyMin\":30},"
            + "{\"id\":\"tiktok\",\"name\":\"TikTok\",\"hosts\":[\"tiktok.com\"],\"on\":false,\"clean\":false,\"dailyMin\":15}],"
            + "\"waitSec\":15,\"waitStepSec\":15,\"minutes\":[5,10,20,30],"
            + "\"work\":{\"on\":true,\"days\":[1,2,3,4,5],\"from\":\"10:00\",\"to\":\"19:00\"},"
            + "\"pause\":null,\"pauseDelayMin\":10}";

    static final long GRACE_MS = 60_000;
    private static Store instance;
    private final SharedPreferences p;

    private Store(Context c) {
        p = c.getApplicationContext().getSharedPreferences("focus", Context.MODE_PRIVATE);
    }

    static synchronized Store get(Context c) {
        if (instance == null) instance = new Store(c);
        return instance;
    }

    /** Приложения сайта: из настроек (apps), а у старых настроек без поля — встроенные. */
    static List<String> packagesOf(JSONObject site) {
        List<String> out = new ArrayList<>();
        JSONArray apps = site.optJSONArray("apps");
        if (apps != null) for (int i = 0; i < apps.length(); i++) out.add(apps.optString(i));
        else for (String[] a : APPS) if (a[0].equals(site.optString("id"))) out.addAll(Arrays.asList(a).subList(1, a.length));
        return out;
    }

    /** Сайт (включённый в настройках), к которому относится приложение, или null. */
    String siteForPackage(String pkg) {
        JSONArray sites = config().optJSONArray("sites");
        if (sites != null) for (int i = 0; i < sites.length(); i++) {
            JSONObject s = sites.optJSONObject(i);
            if (s != null && s.optBoolean("on") && packagesOf(s).contains(pkg)) return s.optString("id");
        }
        return null;
    }

    /** Сайт по адресу из строки браузера («m.youtube.com/watch…», «https://www.ozon.ru/…»). */
    String siteForUrl(String url) {
        String host = url.trim().toLowerCase().replaceFirst("^[a-z]+://", "");
        int cut = host.length();
        for (char ch : new char[]{'/', '?', '#', ':', ' '}) {
            int i = host.indexOf(ch);
            if (i >= 0 && i < cut) cut = i;
        }
        host = host.substring(0, cut);
        if (!host.contains(".")) return null;
        JSONArray sites = config().optJSONArray("sites");
        if (sites != null) for (int i = 0; i < sites.length(); i++) {
            JSONObject s = sites.optJSONObject(i);
            JSONArray hosts = s == null ? null : s.optJSONArray("hosts");
            if (hosts == null || !s.optBoolean("on")) continue;
            for (int k = 0; k < hosts.length(); k++) {
                String h = hosts.optString(k);
                if (!h.isEmpty() && (host.equals(h) || host.endsWith("." + h))) return s.optString("id");
            }
        }
        return null;
    }

    List<String> packagesOf(String siteId) {
        JSONObject s = site(config(), siteId);
        return s == null ? new ArrayList<>() : packagesOf(s);
    }

    /* ───────────── хранение ───────────── */

    private JSONObject obj(String key) {
        try {
            return new JSONObject(p.getString(key, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private JSONArray arr(String key) {
        try {
            return new JSONArray(p.getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private void put(String key, Object v) {
        p.edit().putString(key, v.toString()).apply();
    }

    String hubUrl() {
        return p.getString("hub", "");
    }

    void setHubUrl(String url) {
        p.edit().putString("hub", url.trim().replaceAll("/+$", "")).putLong("syncedAt", 0).apply();
    }

    long syncedAt() {
        return p.getLong("syncedAt", 0);
    }

    String syncError() {
        return p.getString("syncError", "");
    }

    void setSyncResult(String error) {
        SharedPreferences.Editor e = p.edit().putString("syncError", error == null ? "" : error);
        if (error == null) e.putLong("syncedAt", System.currentTimeMillis());
        e.apply();
    }

    /* ───────────── настройки ───────────── */

    synchronized void setRaw(JSONObject config, JSONArray puzzles) {
        p.edit().putString("raw", config == null ? "null" : config.toString()).putString("puzzles", puzzles == null ? "[]" : puzzles.toString()).apply();
    }

    private static JSONObject withDefaults(JSONObject c) throws JSONException {
        JSONObject d = new JSONObject(DEFAULTS);
        if (c == null) return d;
        for (Iterator<String> it = d.keys(); it.hasNext(); ) {
            String k = it.next();
            if (!c.has(k)) c.put(k, d.get(k));
        }
        return c;
    }

    /** Действующие настройки: из хаба (или по умолчанию), ослабленные — только когда наступил их applyAt. */
    synchronized JSONObject config() {
        try {
            String raw = p.getString("raw", "null");
            JSONObject c = withDefaults("null".equals(raw) ? null : new JSONObject(raw));
            JSONObject pending = c.optJSONObject("pending");
            if (pending != null && System.currentTimeMillis() >= pending.optLong("applyAt")) c = withDefaults(pending);
            c.remove("pending");
            return c;
        } catch (JSONException e) {
            try {
                return new JSONObject(DEFAULTS);
            } catch (JSONException x) {
                throw new RuntimeException(x);
            }
        }
    }

    static JSONObject site(JSONObject c, String id) {
        JSONArray sites = c.optJSONArray("sites");
        if (sites != null) for (int i = 0; i < sites.length(); i++) {
            JSONObject s = sites.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) return s;
        }
        return null;
    }

    /** Сайт под защитой: включён в настройках и фокус не на паузе. */
    boolean guarded(String siteId) {
        JSONObject c = config();
        JSONObject s = site(c, siteId);
        return s != null && s.optBoolean("on") && !paused(c, System.currentTimeMillis());
    }

    static boolean paused(JSONObject c, long now) {
        if (!c.optBoolean("enabled", true)) return true;
        JSONObject pause = c.optJSONObject("pause");
        if (pause == null) return false;
        long start = pause.optLong("requestedAt") + c.optLong("pauseDelayMin", 10) * 60_000;
        return now >= start && now < pause.optLong("until");
    }

    static boolean workNow(JSONObject c) {
        JSONObject w = c.optJSONObject("work");
        if (w == null || !w.optBoolean("on")) return false;
        Calendar cal = Calendar.getInstance();
        int day = cal.get(Calendar.DAY_OF_WEEK) - 1; // 0 = воскресенье, как в JS
        JSONArray days = w.optJSONArray("days");
        boolean dayOk = false;
        if (days != null) for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == day) dayOk = true;
        if (!dayOk) return false;
        int hm = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
        return hm >= mins(w.optString("from", "10:00")) && hm < mins(w.optString("to", "19:00"));
    }

    private static int mins(String t) {
        String[] x = t.split(":");
        try {
            return Integer.parseInt(x[0]) * 60 + (x.length > 1 ? Integer.parseInt(x[1]) : 0);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /* ───────────── сеансы ───────────── */

    /** Идущий сеанс на сайте (время могло уже выйти — его закроет GuardService) или null. */
    synchronized JSONObject session(String site) {
        return obj("sessions").optJSONObject(site);
    }

    synchronized JSONObject sessions() {
        return obj("sessions");
    }

    static long dayStart() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Сегодня на сайте: { минут, сеансов } вместе с идущим. */
    synchronized int[] today(String site) {
        long from = dayStart();
        long ms = 0;
        int count = 0;
        JSONArray log = arr("log");
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e == null || !site.equals(e.optString("site")) || e.optLong("endedAt") < from) continue;
            ms += e.optLong("endedAt") - Math.max(e.optLong("startedAt"), from);
            count++;
        }
        JSONObject cur = obj("sessions").optJSONObject(site);
        if (cur != null) {
            ms += System.currentTimeMillis() - Math.max(cur.optLong("startedAt"), from);
            count++;
        }
        return new int[]{(int) Math.round(ms / 60_000.0), count};
    }

    static final class Info {
        String siteName;
        int dailyMin;
        int todayMin;
        int todayCount;
        boolean work;
        boolean limit;
        int wait;
        int[] minutes;
    }

    /** Что показать на экране входа: ожидание растёт с каждым заходом, в рабочее время и после лимита. */
    Info gateInfo(String siteId) {
        JSONObject c = config();
        JSONObject s = site(c, siteId);
        Info i = new Info();
        i.siteName = s != null ? s.optString("name", siteId) : siteId;
        i.dailyMin = s != null ? s.optInt("dailyMin") : 0;
        int[] t = today(siteId);
        i.todayMin = t[0];
        i.todayCount = t[1];
        i.work = workNow(c);
        i.limit = i.dailyMin > 0 && i.todayMin >= i.dailyMin;
        int wait = c.optInt("waitSec", 15) + c.optInt("waitStepSec", 15) * i.todayCount;
        if (i.work) wait *= 2;
        if (i.limit) wait += 60;
        i.wait = Math.min(wait, 300);
        List<Integer> list = new ArrayList<>();
        JSONArray m = c.optJSONArray("minutes");
        if (m != null) for (int k = 0; k < m.length(); k++) {
            int v = m.optInt(k);
            if (v > 0 && (!i.work || v <= 10)) list.add(v);
        }
        java.util.Collections.sort(list);
        if (i.limit && !list.isEmpty()) list = list.subList(0, 1);
        if (list.isEmpty()) list.add(5);
        i.minutes = new int[list.size()];
        for (int k = 0; k < list.size(); k++) i.minutes[k] = list.get(k);
        return i;
    }

    synchronized JSONObject start(String siteId, String purpose, int minutes, int waited) {
        try {
            long now = System.currentTimeMillis();
            JSONObject site = site(config(), siteId);
            JSONObject s = new JSONObject()
                    .put("id", "p" + Long.toString(now, 36) + Integer.toString((int) (Math.random() * 1e6), 36))
                    .put("site", siteId)
                    .put("siteName", site != null ? site.optString("name", siteId) : siteId)
                    .put("purpose", purpose.length() > 300 ? purpose.substring(0, 300) : purpose)
                    .put("minutes", minutes)
                    .put("startedAt", now)
                    .put("endsAt", now + minutes * 60_000L)
                    .put("endedAt", JSONObject.NULL)
                    .put("endedBy", JSONObject.NULL)
                    .put("waited", waited)
                    .put("titles", new JSONArray())
                    .put("device", "phone");
            JSONObject all = obj("sessions");
            all.put(siteId, s);
            put("sessions", all);
            queue(s);
            return s;
        } catch (JSONException e) {
            return null;
        }
    }

    /** Закончить сеанс: by — timer, self или closed; at — когда на самом деле. */
    synchronized JSONObject end(String siteId, String by, long at) {
        try {
            JSONObject all = obj("sessions");
            JSONObject s = all.optJSONObject(siteId);
            if (s == null) return null;
            all.remove(siteId);
            put("sessions", all);
            s.remove("goneAt");
            s.put("endedAt", at).put("endedBy", by);
            JSONArray log = arr("log");
            JSONArray kept = new JSONArray();
            long weekAgo = System.currentTimeMillis() - 8 * 86_400_000L;
            for (int i = 0; i < log.length(); i++) {
                JSONObject e = log.optJSONObject(i);
                if (e != null && e.optLong("endedAt") > weekAgo) kept.put(e);
            }
            kept.put(new JSONObject().put("site", siteId).put("startedAt", s.optLong("startedAt")).put("endedAt", at));
            put("log", kept);
            put("last", s);
            queue(s);
            return s;
        } catch (JSONException e) {
            return null;
        }
    }

    synchronized JSONObject last() {
        return obj("last");
    }

    /** Ушёл из приложения — отметить когда; вернулся — снять отметку. */
    synchronized void markGone(String siteId, long goneAt) {
        try {
            JSONObject all = obj("sessions");
            JSONObject s = all.optJSONObject(siteId);
            if (s == null) return;
            if (goneAt == 0) s.remove("goneAt");
            else if (!s.has("goneAt")) s.put("goneAt", goneAt);
            else return;
            put("sessions", all);
        } catch (JSONException ignored) {
        }
    }

    /* ───────────── очередь в хаб ───────────── */

    private void queue(JSONObject s) throws JSONException {
        JSONArray out = arr("outbox");
        JSONObject copy = new JSONObject(s.toString());
        copy.remove("goneAt");
        out.put(copy);
        while (out.length() > 200) out.remove(0);
        put("outbox", out);
    }

    synchronized JSONArray outbox() {
        return arr("outbox");
    }

    synchronized void dropSent(int n) {
        JSONArray out = arr("outbox");
        JSONArray rest = new JSONArray();
        for (int i = n; i < out.length(); i++) rest.put(out.opt(i));
        put("outbox", rest);
    }

    /* ───────────── задачки «Кругозора» ───────────── */

    /** Задачка на время ожидания, каждый раз новая (пока не кончатся). */
    synchronized JSONObject nextPuzzle() {
        JSONArray all = arr("puzzles");
        if (all.length() == 0) return null;
        JSONArray seen = arr("puzzleSeen");
        List<String> seenIds = new ArrayList<>();
        for (int i = 0; i < seen.length(); i++) seenIds.add(seen.optString(i));
        JSONObject pick = null;
        for (int i = 0; i < all.length() && pick == null; i++) {
            JSONObject x = all.optJSONObject(i);
            if (x != null && !seenIds.contains(x.optString("id"))) pick = x;
        }
        if (pick == null) pick = all.optJSONObject((int) (Math.random() * all.length()));
        if (pick == null) return null;
        seenIds.remove(pick.optString("id"));
        seenIds.add(pick.optString("id"));
        JSONArray next = new JSONArray();
        for (String id : seenIds.subList(Math.max(0, seenIds.size() - 60), seenIds.size())) next.put(id);
        put("puzzleSeen", next);
        return pick;
    }
}
