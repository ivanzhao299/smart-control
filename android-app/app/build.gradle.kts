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
        versionCode = 2
        versionName = "1.0.1"
        // 默认服务器地址 (可在 BuildConfig 用 — APP 启动时如果 SharedPreferences 没保存就用这个作 placeholder)
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://192.168.124.11:5173/control/\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false  // 简单壳, 不混淆方便排错
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

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}
