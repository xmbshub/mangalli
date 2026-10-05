import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "id.mangalli.pos"
    compileSdk = 36

    defaultConfig {
        applicationId = "id.mangalli.pos"
        minSdk = 26
        targetSdk = 35
        versionCode = 30
        versionName = "0.8.8"
        // Server dashboard tujuan tablet. Self-host: ./gradlew assembleRelease -PmangalliServerUrl=https://pos.example.com
        val serverUrl = providers.gradleProperty("mangalliServerUrl").orElse("https://app.mangalli.web.id").get().trimEnd('/')
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    // Kunci rilis di luar repo (~/.mangalli/android-release, simpan cadangannya).
    // Update dalam aplikasi hanya bisa
    // terpasang bila setiap versi ditandatangani kunci yang sama.
    val releaseKey = Properties().apply {
        val file = File(System.getProperty("user.home"), ".mangalli/android-release/keystore.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
    signingConfigs {
        if (releaseKey.isNotEmpty()) create("release") {
            storeFile = File(releaseKey.getProperty("storeFile"))
            storePassword = releaseKey.getProperty("storePassword")
            keyAlias = releaseKey.getProperty("keyAlias")
            keyPassword = releaseKey.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        ignoreAssetsPattern = "._*"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("io.coil-kt.coil3:coil-compose:3.2.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.2.0")
    // Foto produk di dashboard boleh SVG (seperti menu digital); tablet harus bisa menampilkannya.
    implementation("io.coil-kt.coil3:coil-svg:3.2.0")
    // Kode QR QRIS di layar pembayaran (pelanggan memindai dari tablet).
    implementation("com.google.zxing:core:3.5.3")
    implementation("androidx.room:room-runtime:2.8.4")
    kapt("androidx.room:room-compiler:2.8.4")
    testImplementation("junit:junit:4.13.2")
    // org.json di android.jar hanya stub; tes JVM memakai implementasi asli.
    testImplementation("org.json:json:20250517")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

val cleanAppleDoubleFiles by tasks.registering {
    outputs.upToDateWhen { false }
    doLast {
        delete(fileTree(projectDir) {
            include("**/._*")
        })
    }
}

tasks.matching { it.name == "parseDebugLocalResources" || it.name == "parseReleaseLocalResources" }.configureEach {
    dependsOn(cleanAppleDoubleFiles)
}

tasks.matching { it.name == "packageDebugResources" || it.name == "packageReleaseResources" }.configureEach {
    finalizedBy(cleanAppleDoubleFiles)
}
