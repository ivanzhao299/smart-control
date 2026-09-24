const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerConsole = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const welcomeEditor = fs.readFileSync(path.join(__dirname, '../src/composables/useWelcomeEditor.ts'), 'utf8');
const brandingService = fs.readFileSync(path.join(__dirname, '../src/services/system-branding.service.ts'), 'utf8');
const welcomePage = fs.readFileSync(path.join(__dirname, '../public/welcome/index.html'), 'utf8');
const designTokens = fs.readFileSync(path.join(__dirname, '../src/styles/design-tokens.css'), 'utf8');

test('welcome editor separates draft saving from publishing and carries the opened revision', () => {
  assert.match(welcomeEditor, /ensureAdmin\('保存欢迎方案'\)/);
  assert.match(welcomeEditor, /saveWelcomeSchemes\([\s\S]*welcomeSchemesRevision\.value/);
  assert.match(welcomeEditor, /已保存到服务器方案库/);
  assert.match(welcomeEditor, /const confirmed = await fetchWelcomeSchemes\(\)/);
  assert.match(welcomeEditor, /confirmed\.checksum !== saved\.checksum/);
  assert.match(playerConsole, /仅保存方案/);
  assert.match(playerConsole, /保存并发布到 LED/);
  assert.match(welcomeEditor, /ensureAdmin\('发布欢迎页'\)/);
  assert.match(welcomeEditor, /publishWelcomeScheme\(selectedId, welcomeSchemesRevision\.value\)/);
  assert.match(welcomeEditor, /服务器未确认发布结果/);
  assert.match(welcomeEditor, /发布到 LED 大屏/);
});

test('welcome editor uploads logo and background in place and remains scrollable on iPhone', () => {
  assert.match(playerConsole, /welcomeLogoUploadInput/);
  assert.match(playerConsole, /welcomeBgUploadInput/);
  assert.match(welcomeEditor, /mediaService\.upload\(uploadFile/);
  assert.match(playerConsole, /welcomeLogoMediaId/);
  assert.match(playerConsole, /ElScrollbar class="we-scroll" always/);
  assert.match(playerConsole, /class="we-upload-row"/);
  assert.match(playerConsole, /height: 100dvh/);
  assert.match(playerConsole, /\.pick-box\.we-box/);
  assert.match(playerConsole, /\.el-scrollbar__thumb/);
  assert.match(playerConsole, /touch-action: pan-y/);
  assert.match(welcomePage, /id="logoImg"/);
  assert.match(welcomePage, /welcomeLogoUrl/);
});

test('welcome editor keeps uploaded logos and backgrounds in separate libraries and lets admins delete them', () => {
  assert.match(welcomeEditor, /const logoAssets = ref<WelcomeImageAsset\[]>\(\[]\)/);
  assert.match(welcomeEditor, /classifyWelcomeImageAssets\(assets, snapshot\.config\.schemes\)/);
  assert.match(welcomeEditor, /addWelcomeImageAsset\(/);
  assert.match(welcomeEditor, /removeWelcomeAsset\(asset\.id, welcomeSchemesRevision\.value\)/);
  assert.match(playerConsole, /deleteWelcomeImage\('logo', a\)/);
  assert.match(playerConsole, /deleteWelcomeImage\('background', a\)/);
  assert.match(welcomeEditor, /modalClass: 'welcome-image-delete-confirm'/);
  // save/exit three-way prompt must also sit above the z-index 3000 editor; both
  // overlays share one lifted rule block
  assert.match(welcomeEditor, /modalClass: 'welcome-close-confirm'/);
  assert.match(designTokens, /\.el-overlay\.welcome-image-delete-confirm,\s*\.el-overlay\.welcome-close-confirm\s*\{[\s\S]*z-index:\s*4000\s*!important/);
  assert.doesNotMatch(playerConsole, /v-for="a in imageAssets"/);
});

test('welcome editor reopens the last edited saved scheme instead of hiding it behind the published scheme', () => {
  assert.match(welcomeEditor, /LAST_WELCOME_SCHEME_KEY/);
  assert.match(welcomeEditor, /const preferredId = selectedWelcomeSchemeId\.value \|\| rememberedWelcomeSchemeId\(\)/);
  assert.match(welcomeEditor, /snapshot\.config\.schemes\.some\(\(item\) => item\.id === preferredId\)/);
  assert.match(welcomeEditor, /rememberWelcomeSchemeId\(id\)/);
});

test('welcome schemes save their presentation and the live renderer applies the same bounded options', () => {
  assert.match(brandingService, /export interface WelcomePresentation/);
  assert.match(brandingService, /version:\s*2/);
  assert.match(welcomeEditor, /welcomeLayoutOptions/);
  assert.match(playerConsole, /updateWelcomePresentation\('layout'/);
  assert.match(welcomeEditor, /presentation:\s*cloneWelcomePresentation/);
  assert.match(welcomeEditor, /JSON\.stringify\(published\.branding\.welcomePresentation\)/);
  assert.match(welcomePage, /function applyPresentation\(input\)/);
  assert.match(welcomePage, /document\.body\.dataset\.layout/);
  assert.match(welcomePage, /body\[data-layout="editorial"\]/);
  assert.match(welcomePage, /body\[data-layout="minimal"\]/);
});

test('logo selection uses fresh authorized image URLs and an explicit state transition', () => {
  assert.match(welcomeEditor, /const access = await mediaService\.access\(asset\.id\)/);
  assert.match(welcomeEditor, /function selectWelcomeLogo\(mediaId: number \| null\)/);
  assert.match(playerConsole, /@click="selectWelcomeLogo\(a\.id\)"/);
  assert.match(welcomeEditor, /welcomeForm\.value = chooseWelcomeLogo\(welcomeForm\.value, mediaId\)/);
  assert.match(welcomeEditor, /welcomeAssetUploading\.value \|\| welcomeAssetDeletingId\.value/);
});

test('welcome editor converts every new or legacy background before selection', () => {
  assert.match(welcomeEditor, /normalizeWelcomeBackground\(file\)/);
  assert.match(playerConsole, /selectWelcomeBackground\(a\)/);
  assert.match(welcomeEditor, /旧底图已转换为 LED 原生尺寸并选中/);
  assert.doesNotMatch(playerConsole, /:disabled="a\.resolution\?\.toLowerCase\(\) !== LED_CANVAS_RESOLUTION"/);
});

test('PlayerConsole delegates the welcome editing use case without duplicating persistence logic', () => {
  assert.match(playerConsole, /useWelcomeEditor\(\{/);
  assert.match(playerConsole, /republishEditable:\s*async \(\) => \{ await publishWelcome\(SLOT\.value, 'editable'\); \}/);
  assert.doesNotMatch(playerConsole, /async function persistWelcomeSchemes/);
  assert.doesNotMatch(playerConsole, /async function onWelcomeAssetPicked/);
});

test('welcome save contract documents its administrator boundary', () => {
  assert.match(brandingService, /后端仍要求管理员身份/);
  assert.match(brandingService, /expectedRevision/);
  assert.doesNotMatch(brandingService, /客户端 token 即可/);
});


test('welcome venue/org lines are editable, hideable, and published; title offers five effects', () => {
  // editor state lives in the useWelcomeEditor composable: four display text inputs
  // (described by a v-for row config), per-line hide checkbox and three-state helpers
  assert.match(welcomeEditor, /const welcomeHidden = reactive\(/);
  assert.match(welcomeEditor, /function welcomeDisplayValue\(/);
  assert.match(welcomeEditor, /function applyWelcomeDisplay\(/);
  assert.match(welcomeEditor, /watch\(welcomeHidden, scheduleWelcomePreview/);
  assert.match(welcomeEditor, /const welcomeTitleEffectOptions = \[/);
  assert.match(welcomeEditor, /const welcomeDisplayRows = \[/);
  assert.match(welcomeEditor, /场馆中文名/);
  assert.match(welcomeEditor, /落款单位一/);
  // hidden/custom/default rides the publish verification comparison in the composable
  assert.match(welcomeEditor, /published\.branding\.welcomeVenue[\s\S]*selected\.welcomeVenue/);
  assert.match(welcomeEditor, /published\.branding\.welcomeOrg2[\s\S]*selected\.welcomeOrg2/);
  // the template renders the four rows via v-for, with per-row hide checkbox and effect picker
  assert.match(playerConsole, /v-for="row in welcomeDisplayRows"/);
  assert.match(playerConsole, /class="wb-display-row"/);
  assert.match(playerConsole, /v-model="welcomeForm\[row\.formKey\]"/);
  assert.match(playerConsole, /v-model="welcomeHidden\[row\.hideKey\]"/);
  assert.match(playerConsole, /:disabled="welcomeHidden\[row\.hideKey\]"/);
  assert.match(playerConsole, /updateWelcomePresentation\('titleEffect', option\.value\)/);
  // service contract exposes the enum and the new nullable display fields
  assert.match(brandingService, /WelcomeTitleEffect/);
  assert.match(brandingService, /titleEffect\??:/);
  assert.match(brandingService, /welcomeVenue\??: string \| null/);
});

test('LED welcome renderer hides or defaults venue/org lines and ships five title effects', () => {
  // editable line ids + three-state render helpers
  assert.match(welcomePage, /id="venueName"/);
  assert.match(welcomePage, /id="venueEnName"/);
  assert.match(welcomePage, /id="orgName1"/);
  assert.match(welcomePage, /id="orgName2"/);
  assert.match(welcomePage, /const displayText = \(value, fallback\)/);
  assert.match(welcomePage, /const setLine = \(id, text\)/);
  assert.match(welcomePage, /DEFAULT_VENUE_CN/);
  // organizer dot/separator only render when both bylines are visible
  assert.match(welcomePage, /id="orgDotBefore"/);
  assert.match(welcomePage, /id="orgDotAfter"/);
  // effect applied to <body> and one CSS block per effect, placed after tone rules
  assert.match(welcomePage, /document\.body\.dataset\.titleEffect = safe\.titleEffect/);
  assert.match(welcomePage, /body\[data-title-effect="blue"\]/);
  assert.match(welcomePage, /body\[data-title-effect="gold"\]/);
  assert.match(welcomePage, /body\[data-title-effect="white"\]/);
  assert.match(welcomePage, /body\[data-title-effect="ink"\]/);
  assert.match(welcomePage, /body\[data-title-effect="neon"\]/);
});

test('welcome editor offers one-tap save-and-close and a three-way unsaved prompt', () => {
  // one-tap save-and-close action in the composable, wired to a template button
  assert.match(welcomeEditor, /async function saveAndCloseWelcomeEditor\(\)/);
  assert.match(welcomeEditor, /async function saveAndCloseWelcomeEditor\([\s\S]*welcomeEditOpen\.value = false/);
  assert.match(playerConsole, /@click="saveAndCloseWelcomeEditor"/);
  assert.match(playerConsole, /保存并关闭/);
  // closing a dirty draft offers save-and-close / discard-and-close / keep editing
  assert.match(welcomeEditor, /distinguishCancelAndClose: true/);
  assert.match(welcomeEditor, /confirmButtonText: '保存并关闭'/);
  assert.match(welcomeEditor, /cancelButtonText: '放弃修改并关闭'/);
  // the brittle whole-config byte comparison is gone; revision+checksum remain authoritative
  assert.doesNotMatch(welcomeEditor, /JSON\.stringify\(confirmed\.config\)/);
  assert.match(welcomeEditor, /confirmed\.checksum !== saved\.checksum/);
});
