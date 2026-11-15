package ir.roselor.accounting;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class RoselorFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "roselor_general";

    private String sectionName(String section) {
        if (section == null) return "";
        switch (section) {
            case "balances": return "مانده مشتریان";
            case "amb": return "تراکنش‌های مبهم";
            case "ledger": return "گردش حساب بانکی";
            case "bankRecon": return "مغایرت بانکی";
            case "ship": return "بارهای بدون فاکتور";
            case "harvest": return "آمار برداشت";
            case "invoices": return "فاکتورها";
            case "cash": return "ثبت گردش";
            case "buckets": return "سطل‌های برگشتی";
            case "vendors": return "فروشنده‌ها";
            case "users": return "مدیریت کاربران";
            default: return section.equals("home") ? "نمای کلی" : "";
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        getSharedPreferences("roselor_fcm", MODE_PRIVATE)
            .edit().putString("fcm_token", token).apply();
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        String title = message.getNotification() != null
            ? message.getNotification().getTitle() : message.getData().get("title");
        String body = message.getNotification() != null
            ? message.getNotification().getBody() : message.getData().get("body");
        if (title == null || title.trim().isEmpty()) title = "رز لر";
        if (body == null || body.trim().isEmpty()) body = "اعلان جدید دارید";
        String section = message.getData().get("section");
        String sectionLabel = message.getData().get("section_label");
        if (sectionLabel == null || sectionLabel.trim().isEmpty()) sectionLabel = sectionName(section);
        if (sectionLabel != null && !sectionLabel.trim().isEmpty()) title = title + " · " + sectionLabel;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "اعلان‌های رز لر", NotificationManager.IMPORTANCE_DEFAULT
            );
            manager.createNotificationChannel(channel);
        }

        Intent launch = new Intent(this, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (section != null && !section.trim().isEmpty()) launch.putExtra("notification_section", section);
        PendingIntent pending = PendingIntent.getActivity(
            this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending);
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }
}
