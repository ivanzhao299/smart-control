plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jinhu.smartcontrol"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jinhu.smartcontrol"
        minSdk = 24                  // Android 7.0+ — 覆盖 ≥99% 在用机型
        targetSdk = 34
        versionCode = 19
        versionName = "1.1.11"
        // 默认服务器地址 (可在 BuildConfig 用 — APP 启动时如果 SharedPreferences 没保存就用这个作 placeholder)
        // 2026-07-25 改成展厅现场真实地址 (GK9000 静态 IP)
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://192.168.77.54:5173/control/\"")
        // 远程地址默认值 (2026-07-29 业主: "远程地址也要默认填好") — WireGuard 隧道里的 GK9000
        buildConfigField("String", "DEFAULT_REMOTE_URL", "\"http://10.66.66.3:5173/control/\"")
    }

    // 内部分发固定签名 (2026-07-27)。此前 CI 用 assembleDebug — 每台 runner 现生成
    // debug keystore, **每次构建签名都不同**, 终端覆盖安装必失败 (签名冲突), 只能
    // 卸载重装丢配置。这里换成仓库里提交的固定 PKCS12 keystore: 展厅内网 kiosk 壳,
    // 密钥不保护任何敏感能力, 明文口令可接受; 从此 CI 每次出的 APK 同签名, 直接
    // 覆盖升级。上架 Google Play 时另配正式 keystore (见 README)。
    signingConfigs {
        create("internal") {
            storeFile = rootProject.file("signing/internal.p12")
            storeType = "PKCS12"
            storePassword = "jinhu-internal"
            keyAlias = "jinhu-internal"
            keyPassword = "jinhu-internal"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false  // 简单壳, 不混淆方便排错
            signingConfig = signingConfigs.getByName("internal")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("internal")
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
}
