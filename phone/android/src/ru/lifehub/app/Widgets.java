package ru.lifehub.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Виджет «LifeHub» на рабочем столе: те же сводки, что на плитках главной хаба (сколько потрачено,
 * что дальше по расписанию…). Сводки считает сама главная хаба в приложении и присылает через
 * window.LifeHubApp.summaries — виджет показывает последние, с временем обновления.
 */
public class Widgets extends AppWidgetProvider {
    private static final int MAX_ROWS = 6;

    static void save(Context ctx, String json) {
        SharedPreferences p = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE);
        if (json.equals(p.getString("summaries", ""))) return;
        p.edit().putString("summaries", json).putLong("at", System.currentTimeMillis()).apply();
        AppWidgetManager wm = AppWidgetManager.getInstance(ctx);
        int[] ids = wm.getAppWidgetIds(new ComponentName(ctx, Widgets.class));
        for (int id : ids) wm.updateAppWidget(id, render(ctx));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager wm, int[] ids) {
        for (int id : ids) wm.updateAppWidget(id, render(ctx));
    }

    private static PendingIntent open(Context ctx, String path, int code) {
        Intent i = new Intent(ctx, MainActivity.class).putExtra("path", path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 1000 + code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews render(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        v.removeAllViews(R.id.rows);
        v.setOnClickPendingIntent(R.id.header, open(ctx, "/", 0));
        long at = p.getLong("at", 0);
        v.setTextViewText(R.id.updated, at == 0 ? "" : new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(at)));
        List<Object> list = null;
        try {
            list = Json.arr(Json.parse(p.getString("summaries", "[]")));
        } catch (Exception ignored) {
        }
        if (list == null || list.isEmpty()) {
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            row.setTextViewText(R.id.name, "Откройте LifeHub — здесь появятся сводки модулей");
            row.setTextViewText(R.id.value, "");
            row.setTextViewText(R.id.icon, "");
            v.addView(R.id.rows, row);
            return v;
        }
        int n = 0;
        for (Object o : list) {
            if (n >= MAX_ROWS) break;
            Map<String, Object> m = Json.obj(o);
            if (m == null) continue;
            String icon = Json.str(m.get("icon"), "");
            String value = Json.str(m.get("value"), "");
            String text = Json.str(m.get("text"), "");
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            // Иконка модуля — эмодзи; картинку (icon.svg) виджет не покажет — тогда без неё.
            row.setTextViewText(R.id.icon, icon.length() <= 4 ? icon : "");
            row.setTextViewText(R.id.name, value.isEmpty() ? Json.str(m.get("name"), "") + " · " + text : text);
            row.setTextViewText(R.id.value, value);
            row.setOnClickPendingIntent(R.id.row, open(ctx, "/m/" + Json.str(m.get("id"), ""), ++n));
            v.addView(R.id.rows, row);
        }
        return v;
    }
}
