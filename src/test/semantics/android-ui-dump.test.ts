import * as assert from "assert";
import {
  buildAdbCandidates,
  normalizeUiAutomatorDump,
  serializeAndroidUiDumpYaml,
} from "../../features/semantics/android-ui-dump.js";

suite("Android UI semantics dump", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node index="0" class="android.view.View" package="example.app" resource-id="app.page.gesture.tap" content-desc="gesture detector" clickable="true" enabled="true" focusable="true" bounds="[0,0][1000,2000]">
    <node index="0" class="android.view.View" package="example.app" resource-id="" content-desc="" clickable="true" enabled="true" bounds="[0,0][1000,2000]">
      <node index="0" class="android.widget.EditText" package="example.app" resource-id="login.phone.changed" content-desc="" hint="mobile text field&#10;Phone&#10;9X XXX XXXX" clickable="true" enabled="true" focusable="true" password="false" bounds="[50,100][950,250]" />
      <node index="1" class="android.widget.EditText" package="example.app" resource-id="login.password.changed" content-desc="" hint="mobile text field&#10;Password" clickable="true" enabled="true" focusable="true" password="true" bounds="[50,300][950,450]" />
      <node index="2" class="android.view.View" package="example.app" resource-id="" content-desc="" clickable="true" enabled="true" bounds="[60,320][140,420]" />
      <node index="3" class="android.view.View" package="example.app" resource-id="login.submit.pressed" content-desc="mobile button" clickable="false" enabled="true" bounds="[50,500][950,650]">
        <node index="0" class="android.widget.Button" package="example.app" resource-id="" content-desc="Login" clickable="true" enabled="true" focusable="true" bounds="[70,510][930,640]" />
      </node>
      <node index="4" class="android.view.View" package="example.app" resource-id="login.activate.pressed" content-desc="text button" clickable="false" enabled="true" bounds="[50,700][300,780]">
        <node index="0" class="android.widget.Button" package="example.app" resource-id="" content-desc="Activate" clickable="true" enabled="true" focusable="true" bounds="[50,700][300,780]" />
      </node>
      <node index="5" class="android.widget.ImageView" package="example.app" resource-id="" content-desc="" clickable="true" enabled="true" focusable="true" bounds="[500,1500][950,1650]" />
      <node index="6" class="android.widget.Button" package="example.app" resource-id="" content-desc="Guest" clickable="true" enabled="true" focusable="true" bounds="[50,1500][450,1650]" />
      <node index="7" class="android.view.View" package="example.app" resource-id="chat.open.pressed" content-desc="floating action button" clickable="false" enabled="true" bounds="[50,1200][170,1320]">
        <node index="0" class="android.widget.ImageView" package="example.app" resource-id="" content-desc="" clickable="true" enabled="true" focusable="true" bounds="[50,1200][170,1320]" />
      </node>
    </node>
  </node>
</hierarchy>`;

  test("normalizes wrappers and keeps missing semantics visible", () => {
    const result = normalizeUiAutomatorDump(xml, {
      deviceId: "emulator-5554",
      width: 1000,
      height: 2000,
      densityDpi: 420,
      capturedAt: "2026-09-14T00:00:00.000Z",
    });

    assert.deepStrictEqual(result.summary, {
      primary_controls: 7,
      buttons: 5,
      input_fields: 2,
      embedded_actions: 1,
      with_identifier: 5,
      without_identifier: 2,
      missing_accessibility_labels: 1,
      generic_accessibility_labels: 1,
      duplicate_identifiers: 0,
    });
    assert.strictEqual(result.controls[0].label, "Phone");
    assert.strictEqual(result.controls[0].hint, "9X XXX XXXX");
    assert.strictEqual(result.controls.find((control) => control.label === "Login")?.identifier, "login.submit.pressed");
    assert.strictEqual(result.controls.filter((control) => control.identifier === "app.page.gesture.tap").length, 0);
    assert.strictEqual(result.embedded_actions[0].type, "input_accessory");
  });

  test("serializes stable YAML-shaped output", () => {
    const result = normalizeUiAutomatorDump(xml, {
      deviceId: "emulator-5554",
      width: 1000,
      height: 2000,
      capturedAt: "2026-09-14T00:00:00.000Z",
    });
    const yaml = serializeAndroidUiDumpYaml(result);
    assert.ok(yaml.includes("buttons: 5"));
    assert.ok(yaml.includes("input_fields: 2"));
    assert.ok(yaml.includes("identifier: login.password.changed"));
    assert.ok(yaml.includes('node_path: "0.0.1"'));
    assert.ok(yaml.endsWith("\n"));
  });

  test("counts duplicate identifiers shared by embedded actions, not just controls", () => {
    const duplicateXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node index="0" class="android.view.View" package="example.app" resource-id="" content-desc="" clickable="false" enabled="true" bounds="[0,0][1000,600]">
    <node index="0" class="android.view.View" package="example.app" resource-id="" content-desc="" clickable="false" enabled="true" bounds="[0,0][1000,300]">
      <node index="0" class="android.widget.EditText" package="example.app" resource-id="" content-desc="" hint="mobile text field&#10;Search" clickable="true" enabled="true" focusable="true" bounds="[0,0][1000,300]" />
      <node index="1" class="android.widget.ImageView" package="example.app" resource-id="search.action.icon" content-desc="Clear" clickable="true" enabled="true" focusable="true" bounds="[850,50][950,250]" />
    </node>
    <node index="1" class="android.view.View" package="example.app" resource-id="" content-desc="" clickable="false" enabled="true" bounds="[0,300][1000,600]">
      <node index="0" class="android.widget.EditText" package="example.app" resource-id="" content-desc="" hint="mobile text field&#10;Search again" clickable="true" enabled="true" focusable="true" bounds="[0,300][1000,600]" />
      <node index="1" class="android.widget.ImageView" package="example.app" resource-id="search.action.icon" content-desc="Mic" clickable="true" enabled="true" focusable="true" bounds="[850,350][950,550]" />
    </node>
  </node>
</hierarchy>`;
    const result = normalizeUiAutomatorDump(duplicateXml, {
      deviceId: "emulator-5554",
      width: 1000,
      height: 600,
      capturedAt: "2026-09-14T00:00:00.000Z",
    });
    assert.strictEqual(result.embedded_actions.length, 2);
    assert.strictEqual(result.embedded_actions[0].identifier, "search.action.icon");
    assert.strictEqual(result.embedded_actions[1].identifier, "search.action.icon");
    assert.strictEqual(result.controls.some((control) => control.identifier === "search.action.icon"), false);
    assert.strictEqual(result.summary.duplicate_identifiers, 1);
  });

  test("discovers adb in standard Windows, macOS, and Linux locations", () => {
    const windows = buildAdbCandidates(undefined, "win32", {
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      USERPROFILE: "C:\\Users\\tester",
    }, "C:\\Users\\tester");
    const mac = buildAdbCandidates(undefined, "darwin", {}, "/Users/tester");
    const linux = buildAdbCandidates(undefined, "linux", {}, "/home/tester");

    assert.ok(windows.includes("C:\\Users\\tester\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe"));
    assert.ok(windows.includes("adb.exe"));
    assert.ok(mac.includes("/Users/tester/Library/Android/sdk/platform-tools/adb"));
    assert.ok(mac.includes("adb"));
    assert.ok(linux.includes("/home/tester/Android/Sdk/platform-tools/adb"));
    assert.ok(linux.includes("adb"));
  });
});
