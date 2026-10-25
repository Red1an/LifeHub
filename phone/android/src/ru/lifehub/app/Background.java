package ru.lifehub.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Фоновая работа раз в полчаса (и сразу после подключения):
 *  - отправить накопленное без связи и синхронизировать Фокус;
 *  - взять из хаба ближайшие события и поставить будильники — напомнят и без связи;
 *  - новые сообщения Джарвиса — уведомлением;
 *  - сохранить заранее всё для офлайна (оболочку, модули, данные), если давно не сохраняли или есть Wi-Fi.
 */
public class Background extends JobService {
    private static final int JOB = 1;
    private static final long WARM_EVERY_MS = 12 * 3600_000L;

    static void schedule(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB) != null) return;
        js.schedule(new JobInfo.Builder(JOB, new ComponentName(ctx, Background.class))
                .setPeriodic(30 * 60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    static void runNow(Context ctx) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> work(app, true)).start();
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        new Thread(() -> {
            work(getApplicationContext(), false);
            jobFinished(p, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) {
        return true;
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("background", MODE_PRIVATE);
    }

    private static synchronized void work(Context ctx, boolean forceWarm) {
        LifeHub app = LifeHub.get();
        Hub hub = app.hub();
        if (!hub.paired() || hub.route() == null) return;
        app.proxy().replay();
        Sync.run(ctx);
        upcoming(ctx, hub);
        messages(ctx, hub);
        SharedPreferences p = prefs(ctx);
        boolean wifi = unmetered(ctx);
        if (forceWarm || wifi || System.currentTimeMillis() - p.getLong("warmedAt", 0) > WARM_EVERY_MS) {
            try {
                Hub.Response r = hub.call("GET", "/api/app/warm", null, null);
                List<Object> paths = Json.arr(Json.obj(Json.parse(r.text())).get("paths"));
                List<String> list = new ArrayList<>();
                if (paths != null) for (Object o : paths) list.add(Json.str(o, "/"));
                app.proxy().warm(list);
                p.edit().putLong("warmedAt", System.currentTimeMillis()).apply();
            } catch (Exception ignored) {
            }
        }
    }

    private static boolean unmetered(Context ctx) {
        ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
        NetworkCapabilities c = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    }

    /* ───────────── напоминания ───────────── */

    private static void upcoming(Context ctx, Hub hub) {
        try {
            Hub.Response r = hub.call("GET", "/api/app/upcoming", null, null);
            if (r.status != 200) return;
            prefs(ctx).edit().putString("upcoming", r.text()).apply();
            Reminders.schedule(ctx);
        } catch (Exception ignored) {
        }
    }

    private static void messages(Context ctx, Hub hub) {
        SharedPreferences p = prefs(ctx);
        long since = p.getLong("messagesSince", 0);
        if (since == 0) {
            // Первый раз — не вываливать старую переписку.
            p.edit().putLong("messagesSince", System.currentTimeMillis()).apply();
            return;
        }
        try {
            Hub.Response r = hub.call("GET", "/api/app/messages?since=" + since, null, null);
            List<Object> list = Json.arr(Json.parse(r.text()));
            if (list == null) return;
            long max = since;
            for (Object o : list) {
                Map<String, Object> m = Json.obj(o);
                long at = Json.num(m.get("at"), 0);
                max = Math.max(max, at);
                notify(ctx, LifeHub.CH_JARVIS, (int) (at % Integer.MAX_VALUE), "Джарвис", Json.str(m.get("text"), ""), "/m/jarvis");
            }
            p.edit().putLong("messagesSince", max).apply();
        } catch (Exception ignored) {
        }
    }

    static void notify(Context ctx, String channel, int id, String title, String text, String path) {
        Intent open = new Intent(ctx, MainActivity.class).putExtra("path", path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setColor(0xFFFFB7A2)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(channel + id, id, n);
    }

    /** Будильники по сохранённым событиям (их ставит и перезагрузка телефона — без сети). */
    static final class Reminders {
        static void schedule(Context ctx) {
            SharedPreferences p = prefs(ctx);
            AlarmManager am = ctx.getSystemService(AlarmManager.class);
            if (am == null) return;
            // Снять прошлые и поставить заново: события могли передвинуть или удалить.
            for (String code : p.getString("alarms", "").split(",")) {
                if (code.isEmpty()) continue;
                PendingIntent old = PendingIntent.getBroadcast(ctx, Integer.parseInt(code), new Intent(ctx, Alarm.class), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                if (old != null) am.cancel(old);
            }
            StringBuilder codes = new StringBuilder();
            try {
                Map<String, Object> j = Json.obj(Json.parse(p.getString("upcoming", "{}")));
                long lead = Json.num(j.get("lead"), 10) * 60_000;
                List<Object> events = Json.arr(j.get("events"));
                long now = System.currentTimeMillis();
                if (events != null) for (Object o : events) {
                    Map<String, Object> e = Json.obj(o);
                    boolean reminder = "reminder".equals(e.get("kind"));
                    long start = Json.num(e.get("start"), 0);
                    long at = reminder ? start : start - lead;
                    if (at <= now) continue;
                    String title = Json.str(e.get("title"), "");
                    int code = (Json.str(e.get("id"), "") + start).hashCode();
                    Intent i = new Intent(ctx, Alarm.class)
                            .putExtra("title", reminder ? "Напоминание" : "Скоро: " + title)
                            .putExtra("text", reminder ? title : "Через " + (lead / 60_000) + " мин — " + title)
                            .putExtra("code", code);
                    PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    if (android.os.Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    codes.append(code).append(',');
                }
            } catch (Exception ignored) {
            }
            p.edit().putString("alarms", codes.toString()).apply();
        }
    }

    /** Сработал будильник события. */
    public static class Alarm extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent i) {
            Background.notify(ctx, LifeHub.CH_REMIND, i.getIntExtra("code", 0), i.getStringExtra("title"), i.getStringExtra("text"), "/m/planner");
        }
    }

    /** Телефон перезагрузился — будильники пропали, ставим заново; фоновая задача восстановится сама. */
    public static class Boot extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent i) {
            Reminders.schedule(ctx);
            schedule(ctx);
        }
    }

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
