package ir.roselor.accounting;

import android.app.Activity;
import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4107;
    private static final String CHANNEL_ID = "roselor_general";
    private static final String DRIVER_URL = "https://alitoorabi-maker.github.io/roselor-accounting/driver.html?v=2";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF061A12);
        getWindow().setNavigationBarColor(0xFF061A12);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        createNotificationChannel();
        webView.addJavascriptInterface(new AndroidNotificationBridge(), "RoselorAndroid");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        if (state == null) webView.loadUrl(DRIVER_URL); else webView.restoreState(state);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "اعلان‌های رز لر", NotificationManager.IMPORTANCE_DEFAULT);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private class AndroidNotificationBridge {
        @JavascriptInterface public void requestFcmToken() {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || webView == null) return;
                String token = JSONObject.quote(task.getResult());
                runOnUiThread(() -> webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('roselor-fcm-token',{detail:{token:" + token + "}}));", null));
            });
        }
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    dispatchPermission(true); return;
                }
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            });
        }
    }

    private void dispatchPermission(boolean granted) {
        if (webView != null) webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('roselor-notification-permission',{detail:{granted:" + granted + "}}));", null);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST)
            dispatchPermission(grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED);
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (webView != null) webView.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}