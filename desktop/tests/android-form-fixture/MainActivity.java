// Java / MainActivity.java / Android 14 emulator only / isolated input-verification fixture
package com.zyon.formfixture;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.text.InputType;
import android.view.View;
import android.widget.*;

public class MainActivity extends Activity {
    private LinearLayout layout;
    private EditText email;
    private TextView result;
    public void onCreate(Bundle state) {
        super.onCreate(state);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 48, 24, 24);
        TextView heading = new TextView(this);
        heading.setText("Qual é o seu email?");
        heading.setTextSize(24);
        layout.addView(heading);
        email = new EditText(this);
        email.setHint("Email");
        email.setContentDescription("Email");
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        email.setSingleLine(true);
        layout.addView(email);
        EditText password = new EditText(this);
        password.setHint("Senha");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(password);
        Button submit = new Button(this);
        submit.setText("Avançar");
        layout.addView(submit);
        result = new TextView(this);
        layout.addView(result);
        submit.setOnClickListener(v -> result.setText(email.getText().toString().equals("owner@example.com") ? "Entrada confirmada" : "Entrada incorreta"));
        Button delayed = new Button(this);
        delayed.setText("Recriar campo");
        layout.addView(delayed);
        delayed.setOnClickListener(v -> {
            layout.removeView(email);
            new Handler().postDelayed(() -> {
                email = new EditText(this);
                email.setHint("Email");
                email.setContentDescription("Email");
                email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
                email.setSingleLine(true);
                layout.addView(email, 1);
            }, 1800);
        });
        setContentView(layout);
    }
}
