package ir.roselor.supervisor;
import android.app.Activity; import android.os.Bundle; import android.webkit.WebView; import android.webkit.WebViewClient; import android.webkit.WebChromeClient; import android.graphics.Color;
public class MainActivity extends Activity {
 private WebView web;
 @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().setStatusBarColor(Color.rgb(6,26,18));getWindow().setNavigationBarColor(Color.rgb(6,26,18));web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setDatabaseEnabled(true);web.setWebViewClient(new WebViewClient());web.setWebChromeClient(new WebChromeClient());setContentView(web);web.loadUrl("https://alitoorabi-maker.github.io/roselor-accounting/supervisor-portal.html");}
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
}
