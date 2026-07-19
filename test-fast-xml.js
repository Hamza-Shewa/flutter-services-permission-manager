const { XMLParser } = require('fast-xml-parser');

const xml = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
    <!-- comment -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
</manifest>
`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  preserveOrder: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
});

const result = parser.parse(xml);
console.log(JSON.stringify(result, null, 2));
