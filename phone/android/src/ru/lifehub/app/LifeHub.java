package ru.lifehub.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.ConnectivityManager;
import android.net.Network;

import java.io.File;

/**
 * Приложение: один Hub (связь с компьютером) и один Proxy (хаб на 127.0.0.1 с сохранённым для офлайна)
 * на всё время жизни процесса. Сменилась сеть — сразу проверить дорогу к хабу.
 */
public class LifeHub extends Application {
    static final String CH_REMIND = "remind";
    static final String CH_JARVIS = "jarvis";
    static final String CH_FOCUS = "focus";

    private static LifeHub app;
    private Hub hub;
    private Proxy proxy;
    private int port;

    @Override
    public void onCreate() {
        super.onCreate();
        app = this;
        File dir = new File(getFilesDir(), "hub");
        hub = new Hub(dir);
        proxy = new Proxy(hub, dir);
        channels();
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm != null) cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                hub.wake();
            }

            @Override
            public void onLost(Network n) {
                hub.wake();
            }
        });
        Background.schedule(this);
    }

    static LifeHub get() {
        return app;
    }

    Hub hub() {
        return hub;
    }

    Proxy proxy() {
        return proxy;
    }

    /** Адрес хаба внутри телефона (прокси запускается при первом обращении). */
    synchronized String local() {
        if (port == 0) {
            try {
                port = proxy.start();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        return "http://127.0.0.1:" + port;
    }

    private void channels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel remind = new NotificationChannel(CH_REMIND, "Напоминания и события", NotificationManager.IMPORTANCE_HIGH);
        remind.setDescription("Из «Расписания»: напоминания и «скоро событие»");
        NotificationChannel jarvis = new NotificationChannel(CH_JARVIS, "Джарвис", NotificationManager.IMPORTANCE_DEFAULT);
        jarvis.setDescription("Ответы и сообщения Джарвиса");
        NotificationChannel focus = new NotificationChannel(CH_FOCUS, "Фокус", NotificationManager.IMPORTANCE_LOW);
        focus.setDescription("Сколько осталось на YouTube и в Инсте");
        nm.createNotificationChannel(remind);
        nm.createNotificationChannel(jarvis);
        nm.createNotificationChannel(focus);
    }
}
