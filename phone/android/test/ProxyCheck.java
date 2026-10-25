import java.io.File;
import ru.lifehub.app.Hub;
import ru.lifehub.app.Proxy;

/**
 * Проверка прокси приложения на компьютере: подключается к хабу как телефон и открывает его на 127.0.0.1.
 *   java ProxyCheck <папка> <адрес хаба> <код из /api/app/pair>   — первый раз
 *   java ProxyCheck <папка>                                         — потом
 * Файл <папка>/offline есть — прокси ведёт себя как телефон без связи.
 */
public class ProxyCheck {
    public static void main(String[] a) throws Exception {
        File dir = new File(a[0]);
        Hub hub = new Hub(dir);
        if (a.length >= 3) hub.claim(a[1], a[2], "Проверка на компьютере");
        Proxy proxy = new Proxy(hub, dir);
        hub.setListener(on -> System.out.println(on ? "▲ на связи" : "▼ без связи"));
        proxy.setListener(() -> System.out.println("✓ очередь отправлена"));
        System.out.println("PORT " + proxy.start());
        // Как фоновая задача приложения: сохранить заранее всё для офлайна.
        if (new File(dir, "offline").exists()) hub.setForcedOffline(true);
        else try {
        Hub.Response w = hub.call("GET", "/api/app/warm", null, null);
        java.util.List<String> paths = new java.util.ArrayList<>();
        for (Object o : ru.lifehub.app.Json.arr(ru.lifehub.app.Json.obj(ru.lifehub.app.Json.parse(w.text())).get("paths"))) paths.add((String) o);
        proxy.warm(paths);
        System.out.println("сохранено заранее: " + paths.size() + " путей, " + proxy.cacheBytes() / 1024 + " КБ");
        } catch (Exception e) {
            System.out.println("не сохранил заранее: " + e.getMessage());
        }
        File flag = new File(dir, "offline");
        boolean off = flag.exists();
        while (true) {
            Thread.sleep(500);
            if (flag.exists() != off) {
                off = flag.exists();
                hub.setForcedOffline(off);
                System.out.println(off ? "режим без связи" : "связь вернулась, в очереди: " + proxy.queued());
                if (!off) System.out.println(proxy.replay() ? "очередь пуста" : "не всё ушло");
            }
        }
    }
}
