package ru.lifehub.app;

import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Фокус ↔ хаб: настройки (/api/app/focus/config) и сеансы (/api/app/focus/sessions) — той же дорогой, что и весь хаб.
 * Хаб нужен только для настроек и статистики: блокировка работает по последним полученным настройкам
 * (или по умолчанию), а сеансы ждут в очереди, пока хаб снова не станет доступен.
 */
final class Sync {
    private static final ExecutorService pool = Executors.newSingleThreadExecutor();
    private static long lastRun = 0;

    /** Не чаще раза в minGapMs; 0 — сразу. */
    static void soon(Context ctx, long minGapMs) {
        long now = System.currentTimeMillis();
        if (now - lastRun < minGapMs) return;
        lastRun = now;
        final Context app = ctx.getApplicationContext();
        pool.execute(() -> run(app));
    }

    /** Раз в сутки — какие приложения стоят на телефоне: в модуле их выбирают для сайтов. */
    private static void apps(Context ctx, Hub hub) throws Exception {
        android.content.SharedPreferences p = ctx.getSharedPreferences("focus", Context.MODE_PRIVATE);
        if (System.currentTimeMillis() - p.getLong("appsSentAt", 0) < 86_400_000L) return;
        android.content.pm.PackageManager pm = ctx.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        JSONArray list = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (android.content.pm.ResolveInfo r : pm.queryIntentActivities(launcher, 0)) {
            String pkg = r.activityInfo.packageName;
            if (pkg.equals(ctx.getPackageName()) || !seen.add(pkg)) continue;
            list.put(new JSONObject().put("pkg", pkg).put("label", String.valueOf(r.loadLabel(pm))));
        }
        Map<String, String> h = new LinkedHashMap<>();
        h.put("content-type", "application/json");
        h.put("x-lifehub", "1");
        Hub.Response r = hub.call("POST", "/api/app/focus/apps", h, new JSONObject().put("apps", list).toString().getBytes(StandardCharsets.UTF_8));
        if (r.status == 200) p.edit().putLong("appsSentAt", System.currentTimeMillis()).apply();
    }

    /** Синхронно — для фоновой задачи. */
    static void run(Context ctx) {
        Store st = Store.get(ctx);
        Hub hub = LifeHub.get().hub();
        if (!hub.paired()) return;
        try {
            Hub.Response r = hub.call("GET", "/api/app/focus/config?v=" + BuildInfo.VERSION, null, null);
            if (r.status != 200) throw new Exception("Хаб ответил " + r.status);
            JSONObject j = new JSONObject(r.text());
            st.setRaw(j.optJSONObject("config"), j.optJSONArray("puzzles"));
            JSONArray out = st.outbox();
            if (out.length() > 0) {
                Map<String, String> h = new LinkedHashMap<>();
                h.put("content-type", "application/json");
                h.put("x-lifehub", "1");
                Hub.Response p = hub.call("POST", "/api/app/focus/sessions", h,
                        new JSONObject().put("sessions", out).toString().getBytes(StandardCharsets.UTF_8));
                if (p.status != 200) throw new Exception("Хаб ответил " + p.status);
                st.dropSent(out.length());
            }
            apps(ctx, hub);
            st.setSyncResult(null);
        } catch (Exception e) {
            st.setSyncResult(e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }
}
