plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val signingStoreFile = providers.environmentVariable("ANDROID_SIGNING_STORE_FILE").orNull
val signingStorePassword = providers.environmentVariable("ANDROID_SIGNING_STORE_PASSWORD").orNull
val signingKeyAlias = providers.environmentVariable("ANDROID_SIGNING_KEY_ALIAS").orNull
val signingKeyPassword = providers.environmentVariable("ANDROID_SIGNING_KEY_PASSWORD").orNull
val signingValues = listOf(
    signingStoreFile,
    signingStorePassword,
    signingKeyAlias,
    signingKeyPassword,
)
val signingConfigured = signingValues.all { !it.isNullOrBlank() }

if (!signingConfigured && signingValues.any { !it.isNullOrBlank() }) {
    throw GradleException("Android signing environment is incomplete")
}

android {
    namespace = "com.jinhu.smartcontrol"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jinhu.smartcontrol"
        minSdk = 24                  // Android 7.0+ — 覆盖 ≥99% 在用机型
        targetSdk = 34
        versionCode = 23
        versionName = "1.1.15"
        // 默认服务器地址 (可在 BuildConfig 用 — APP 启动时如果 SharedPreferences 没保存就用这个作 placeholder)
        // 2026-07-25 改成展厅现场真实地址 (GK9000 静态 IP)
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://192.168.77.54:5173/control/\"")
        // 已备案且具备可信证书的生产 HTTPS 入口。
        buildConfigField("String", "DEFAULT_REMOTE_URL", "\"https://park.cnjinhu.com/control/\"")
    }

    // Internal release signing is injected by CI from encrypted repository secrets.
    // The certificate stays identical to installed clients so APK updates remain
    // compatible, while the private key and passwords stay outside the source tree.
    signingConfigs {
        if (signingConfigured) {
            create("internal") {
                storeFile = rootProject.file(signingStoreFile!!)
                storeType = "PKCS12"
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false  // 简单壳, 不混淆方便排错
            if (signingConfigured) {
                signingConfig = signingConfigs.getByName("internal")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

gradle.taskGraph.whenReady {
    val releaseRequested = allTasks.any { it.name.contains("Release", ignoreCase = true) }
    if (releaseRequested && !signingConfigured) {
        throw GradleException(
            "Release signing requires ANDROID_SIGNING_STORE_FILE, " +
                "ANDROID_SIGNING_STORE_PASSWORD, ANDROID_SIGNING_KEY_ALIAS and " +
                "ANDROID_SIGNING_KEY_PASSWORD",
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
    // 面容/指纹应用锁 (2026-07-30): 系统 BiometricPrompt, 自动落到面部/指纹/锁屏密码
    implementation("androidx.biometric:biometric:1.1.0")
    // 面容登录 (2026-07-31): 访问密码存 Keystore 加密的 SharedPreferences
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    testImplementation("junit:junit:4.13.2")
}
