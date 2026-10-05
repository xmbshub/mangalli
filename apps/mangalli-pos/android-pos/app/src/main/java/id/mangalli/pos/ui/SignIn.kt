package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.mangalli.pos.R
import id.mangalli.pos.security.OfflineStaff
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay

// Masuk kasir. Tablet yang sudah terhubung menampilkan kasir yang pernah masuk
// di sini (masuk offline dengan kata sandi). Formulir lengkap dipakai untuk
// menghubungkan tablet pertama kali atau kasir baru (butuh internet).
@Composable
fun SignInScreen(state: PosUiState, actions: PosActions) {
    var useForm by rememberSaveable { mutableStateOf(false) }
    var selectedEmail by rememberSaveable { mutableStateOf<String?>(null) }
    val showPicker = state.deviceRegistered && state.knownStaff.isNotEmpty() && !useForm

    Row(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        BrandPanel(state, actions, modifier = Modifier.weight(1f).fillMaxHeight())
        Box(
            modifier = Modifier.weight(1f).fillMaxHeight().background(Pos.Surface).imePadding(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier.width(440.dp).verticalScroll(rememberScrollState()).padding(vertical = Pos.Space8),
                verticalArrangement = Arrangement.spacedBy(Pos.Space5),
            ) {
                AnimatedContent(
                    targetState = if (showPicker) "picker" else "form",
                    transitionSpec = { fadeIn(tween(120)) togetherWith ExitTransition.None },
                    label = "sign-in-mode",
                ) { mode ->
                    if (mode == "picker") {
                        StaffPicker(
                            state = state,
                            selectedEmail = selectedEmail,
                            onSelect = { selectedEmail = it },
                            onSignIn = { email, password -> actions.signIn(state.savedOutletKey, email, password) },
                            onUseAnotherAccount = { useForm = true; selectedEmail = null },
                        )
                    } else {
                        AccountForm(
                            state = state,
                            onSubmit = actions::signIn,
                            onBack = if (state.deviceRegistered && state.knownStaff.isNotEmpty()) ({ useForm = false }) else null,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BrandPanel(state: PosUiState, actions: PosActions, modifier: Modifier) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(15_000)
        }
    }
    Column(
        modifier = modifier.background(Pos.PrimarySoft).padding(Pos.Space8),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Box(
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(Pos.Radius)).background(Pos.Surface).border(1.dp, Pos.PrimaryLine, RoundedCornerShape(Pos.Radius)),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.mangalli_logo), contentDescription = null, modifier = Modifier.size(34.dp))
            }
            Column {
                Text("Mangalli POS", style = PosType.Heading, color = Pos.Ink)
                Text("Mulai jualan, tanpa ribet.", style = PosType.Caption, color = Pos.Muted)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            Text(SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(now)), style = PosType.Amount.copy(fontSize = PosType.Amount.fontSize * 2.6f, lineHeight = PosType.Amount.lineHeight * 2.4f), color = Pos.Ink)
            Text(SimpleDateFormat("EEEE, d MMMM", Locale.ENGLISH).format(Date(now)), style = PosType.Heading, color = Pos.Text)
            clockDriftLabel(state.operations.clockOffsetMillis)?.let { drift ->
                Text("This tablet's clock is $drift. Fix it in Android settings.", style = PosType.BodySmall, color = Pos.Warning)
            }
            if (state.deviceRegistered) {
                Spacer(Modifier.height(Pos.Space2))
                Text(state.outlet.name, style = PosType.Title, color = Pos.PrimaryPressed, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        // Status koneksi dan server sebagai pill sejajar di kiri bawah, kredit
        // pembuat di ujung kanan; panel kanan khusus untuk masuk.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            Pill(
                if (state.operations.isOnline) "Online" else "Offline",
                if (state.operations.isOnline) Tone.Success else Tone.Neutral,
                icon = if (state.operations.isOnline) Icons.Outlined.Wifi else Icons.Outlined.CloudOff,
            )
            ServerLine(state, actions)
            Spacer(Modifier.weight(1f))
            Text(BRAND_CREDIT, style = PosType.Caption, color = Pos.Subtle)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StaffPicker(
    state: PosUiState,
    selectedEmail: String?,
    onSelect: (String?) -> Unit,
    onSignIn: (String, String) -> Unit,
    onUseAnotherAccount: () -> Unit,
) {
    var password by remember(selectedEmail) { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val selected = state.knownStaff.firstOrNull { it.email == selectedEmail }
    LaunchedEffect(selectedEmail) { if (selectedEmail != null) runCatching { focus.requestFocus() } }

    // Judul, subjudul, dan kartu akun rata tengah; kartu berapa pun jumlahnya
    // tetap di tengah (2 akun tidak menyisakan kolom kosong di kanan).
    Column(verticalArrangement = Arrangement.spacedBy(Pos.Space5), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space1), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Who's working?", style = PosType.Title, color = Pos.Ink, textAlign = TextAlign.Center)
            Text("Choose your name, then enter your password.", style = PosType.Body, color = Pos.Muted, textAlign = TextAlign.Center)
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Pos.Space3, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(Pos.Space3),
        ) {
            state.knownStaff.forEach { staff ->
                StaffTile(staff, selected = staff.email == selectedEmail) { onSelect(if (staff.email == selectedEmail) null else staff.email) }
            }
        }
        if (selected != null) {
            PosTextField(
                value = password,
                onValueChange = { password = it.take(128) },
                label = "Password for ${selected.name}",
                password = true,
                imeAction = ImeAction.Go,
                onImeAction = { if (password.isNotBlank()) onSignIn(selected.email, password) },
                focusRequester = focus,
                error = state.signInError,
            )
            PosButton(
                "Sign in",
                onClick = { onSignIn(selected.email, password) },
                size = ButtonSize.Large,
                enabled = password.isNotBlank(),
                loading = state.isBusy,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        PosButton("Use another account", onClick = onUseAnotherAccount, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun StaffTile(staff: OfflineStaff, selected: Boolean, onClick: () -> Unit) {
    PosCard(onClick = onClick, selected = selected, padding = androidx.compose.foundation.layout.PaddingValues(Pos.Space3), modifier = Modifier.width(136.dp).height(112.dp)) {
        Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically)) {
            Avatar(staff.name, size = 44.dp, selected = selected)
            Text(staff.name, style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(roleLabel(staff.role), style = PosType.Micro.copy(fontWeight = PosType.Body.fontWeight), color = Pos.Muted)
        }
    }
}

fun roleLabel(role: String?): String = when (role) {
    "owner" -> "Owner"
    "manager" -> "Manager"
    "staff" -> "Cashier"
    "viewer" -> "Viewer"
    else -> role.orEmpty().replaceFirstChar { it.uppercase() }
}

@Composable
private fun AccountForm(state: PosUiState, onSubmit: (String, String, String) -> Unit, onBack: (() -> Unit)?) {
    var outletKey by rememberSaveable { mutableStateOf(state.savedOutletKey) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val emailFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val canSubmit = outletKey.isNotBlank() && email.contains('@') && password.isNotBlank()
    val submit = { if (canSubmit) onSubmit(outletKey.trim(), email.trim(), password) }

    Column(verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        if (onBack != null) {
            PosButton("Back", onClick = onBack, variant = ButtonVariant.Ghost, size = ButtonSize.Small, icon = Icons.AutoMirrored.Outlined.ArrowBack)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space1)) {
            Text(if (state.deviceRegistered) "Sign in" else "Connect this tablet", style = PosType.Title, color = Pos.Ink)
            Text(
                if (state.deviceRegistered) "Use your Mangalli account."
                else "Owner or manager account.",
                style = PosType.Body,
                color = Pos.Muted,
            )
        }
        if (!state.operations.isOnline) {
            InfoBanner("Offline. New accounts need internet.", tone = Tone.Warning)
        }
        PosTextField(
            value = outletKey,
            onValueChange = { outletKey = it.trim().lowercase(Locale.ROOT).take(64) },
            label = "Outlet code",
            placeholder = "e.g. my-cafe",
            imeAction = ImeAction.Next,
            onImeAction = { runCatching { emailFocus.requestFocus() } },
            enabled = !state.deviceRegistered || state.savedOutletKey.isBlank(),
        )
        PosTextField(
            value = email,
            onValueChange = { email = it.take(200) },
            label = "Email",
            placeholder = "name@business.com",
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Next,
            onImeAction = { runCatching { passwordFocus.requestFocus() } },
            focusRequester = emailFocus,
        )
        PosTextField(
            value = password,
            onValueChange = { password = it.take(128) },
            label = "Password",
            password = true,
            imeAction = ImeAction.Go,
            onImeAction = submit,
            focusRequester = passwordFocus,
            error = state.signInError,
        )
        PosButton(
            if (state.deviceRegistered) "Sign in" else "Connect & sign in",
            onClick = submit,
            size = ButtonSize.Large,
            enabled = canSubmit,
            loading = state.isBusy,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun ServerLine(state: PosUiState, actions: PosActions) {
    var editing by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
        Pill("Server: ${state.serverHost}", Tone.Neutral, icon = Icons.Outlined.Dns)
        if (state.debugBuild && !state.deviceRegistered) {
            PosButton("Change", onClick = { editing = true }, variant = ButtonVariant.Ghost, size = ButtonSize.Small)
        }
    }
    if (editing) {
        var url by remember { mutableStateOf("https://${state.serverHost}") }
        PosDialog(onDismiss = { editing = false }, width = 480.dp) {
            DialogHeader("Server address", "Test builds only.", onClose = { editing = false })
            DialogBody {
                PosTextField(url, { url = it.trim() }, "Address", keyboardType = KeyboardType.Uri, onImeAction = { actions.setServer(url); editing = false })
            }
            DialogFooter {
                PosButton("Use production", onClick = { actions.setServer("https://app.mangalli.web.id"); editing = false }, variant = ButtonVariant.Secondary)
                PosButton("Save", onClick = { actions.setServer(url); editing = false }, enabled = url.startsWith("http"))
            }
        }
    }
}
