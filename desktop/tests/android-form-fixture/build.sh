#!/usr/bin/env bash
# Bash / build.sh / Linux CI + Android SDK 35 / isolated verification APK
set -euo pipefail
fixture_root=$(cd "$(dirname "$0")" && pwd)
fixture_out="$fixture_root/build"
fixture_sdk="${ANDROID_HOME:?Android SDK is required}"
fixture_tools="$fixture_sdk/build-tools/35.0.0"
mkdir -p "$fixture_out/classes" "$fixture_out/dex"
javac -encoding UTF-8 -source 8 -target 8 -classpath "$fixture_sdk/platforms/android-34/android.jar" -d "$fixture_out/classes" "$fixture_root/MainActivity.java"
shopt -s globstar nullglob
fixture_classes=("$fixture_out/classes"/**/*.class)
if (( ${#fixture_classes[@]} == 0 )); then echo 'Fixture compilation produced no classes.' >&2; exit 1; fi
"$fixture_tools/d8" --min-api 23 --lib "$fixture_sdk/platforms/android-34/android.jar" --output "$fixture_out/dex" "${fixture_classes[@]}"
"$fixture_tools/aapt2" link -o "$fixture_out/unsigned.apk" --manifest "$fixture_root/AndroidManifest.xml" -I "$fixture_sdk/platforms/android-34/android.jar"
(cd "$fixture_out/dex" && zip -q -j "$fixture_out/unsigned.apk" classes.dex)
"$fixture_tools/zipalign" -f 4 "$fixture_out/unsigned.apk" "$fixture_out/aligned.apk"
if [[ ! -f "$fixture_out/debug.keystore" ]]; then
  keytool -genkeypair -keystore "$fixture_out/debug.keystore" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 30 -dname 'CN=Zyon Emulator Fixture'
fi
"$fixture_tools/apksigner" sign --ks "$fixture_out/debug.keystore" --ks-pass pass:android --out "$fixture_out/fixture.apk" "$fixture_out/aligned.apk"
