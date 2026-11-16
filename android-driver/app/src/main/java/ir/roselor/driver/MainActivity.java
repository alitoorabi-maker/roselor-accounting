package ir.roselor.driver;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 6107;
    private static final String CHANNEL_ID = "roselor_driver";
    private static MainActivity active;
    private WebView web;
    private static final String PORTAL_URL = "https://alitoorabi-maker.github.io/roselor-accounting/driver.html";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        active = this;
        getWindow().setStatusBarColor(Color.rgb(6,26,18));
        getWindow().setNavigationBarColor(Color.rgb(6,26,18));
        createNotificationChannel();
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setSafeBrowsingEnabled(true);
        web.getSettings().setLoadsImagesAutomatically(true);
        web.addJavascriptInterface(new AndroidBridge(), "RoselorAndroid");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        setContentView(web);
        web.loadUrl(PORTAL_URL);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "اعلان‌های راننده رز لر", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("اعلان بارها، تحویل‌ها و درخواست‌های راننده");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void dispatchPermission(boolean granted) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('roselor-notification-permission',{detail:{granted:" + granted + "}}));", null);
    }
    private void dispatchToken(String token) {
        if (web != null) {
            String safe = token.replace("\\", "\\\\").replace("'", "\\'");
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('roselor-fcm-token',{detail:{token:'" + safe + "'}}));", null);
        }
    }
    public static void deliverRefreshedToken(String token) {
        MainActivity a = active;
        if (a != null) a.runOnUiThread(() -> a.dispatchToken(token));
    }

    private class AndroidBridge {
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    dispatchPermission(true); return;
                }
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            });
        }
        @JavascriptInterface public void requestFcmToken() {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    if (web != null) web.post(() -> dispatchToken(""));
                    return;
                }
                String token = task.getResult();
                getSharedPreferences("roselor_driver", MODE_PRIVATE).edit().putString("fcm_token", token).apply();
                if (web != null) web.post(() -> dispatchToken(token));
            });
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) dispatchPermission(grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED);
    }
    @Override protected void onDestroy() { if (active == this) active = null; super.onDestroy(); }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
