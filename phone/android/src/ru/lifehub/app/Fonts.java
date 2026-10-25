package ru.lifehub.app;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Шрифты модулей (Google Fonts) — в обход прокси, поэтому сохраняем их сами: один раз скачались,
 * дальше открываются и без связи. Ответы с CORS-заголовком, иначе @font-face не примет файл.
 */
final class Fonts {
    private final File dir;

    Fonts(Context ctx) {
        dir = new File(ctx.getCacheDir(), "fonts");
        dir.mkdirs();
    }

    static boolean handles(String host) {
        return "fonts.googleapis.com".equals(host) || "fonts.gstatic.com".equals(host);
    }

    WebResourceResponse get(String url, String userAgent) {
        String name = sha1(url);
        File body = new File(dir, name);
        File type = new File(dir, name + ".type");
        try {
            if (!body.exists() || url.contains("fonts.googleapis.com")) {
                // Стили шрифтов обновляем при каждой возможности, сами файлы (gstatic) не меняются.
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(15000);
                if (userAgent != null) c.setRequestProperty("user-agent", userAgent);
                if (c.getResponseCode() == 200) {
                    byte[] b = Hub.readAll(c.getInputStream());
                    Files.write(body.toPath(), b);
                    String t = c.getContentType();
                    Files.write(type.toPath(), (t == null ? "application/octet-stream" : t).getBytes(StandardCharsets.UTF_8));
                }
                c.disconnect();
            }
        } catch (IOException ignored) {
        }
        if (!body.exists()) return null;
        try {
            String t = type.exists() ? new String(Files.readAllBytes(type.toPath()), StandardCharsets.UTF_8) : "application/octet-stream";
            String mime = t.split(";")[0].trim();
            Map<String, String> h = new LinkedHashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, 200, "OK", h,
                    new ByteArrayInputStream(Files.readAllBytes(body.toPath())));
        } catch (IOException e) {
            return null;
        }
    }

    private static String sha1(String s) {
        try {
            StringBuilder b = new StringBuilder();
            for (byte x : MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8))) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
