// net/AuthManager.ts
// 掛在「登入場景」的一個節點上。負責 Email 登入 / 註冊 / 登出。
// 編輯器裡把按鈕的 ClickEvents 指到本元件的 onLogin / onSignUp / onLogout。

import FirebaseService from "./FirebaseService";

const { ccclass, property } = cc._decorator;

@ccclass
export default class AuthManager extends cc.Component {
    @property(cc.EditBox) emailInput: cc.EditBox = null;
    @property(cc.EditBox) passwordInput: cc.EditBox = null;
    @property({ type: cc.EditBox, tooltip: "註冊用的顯示名稱（可留空，會用 email 前段）" })
    nameInput: cc.EditBox = null;
    @property(cc.Label) statusLabel: cc.Label = null;
    @property({ tooltip: "登入/註冊成功後要載入的場景" })
    nextScene: string = "Menu";
    @property({ tooltip: "已登入時是否自動跳到 nextScene" })
    autoSkipIfLoggedIn: boolean = true;

    onLoad() {
        FirebaseService.init();
        FirebaseService.onAuthChanged((u) => {
            if (u) {
                this.setStatus(`已登入：${u.email || u.uid}`);
                if (this.autoSkipIfLoggedIn) this.goNext();
            } else {
                this.setStatus("請登入或註冊");
            }
        });
    }

    onLogin() {
        const e = this.val(this.emailInput);
        const p = this.val(this.passwordInput);
        if (!e || !p) { this.setStatus("請輸入 Email 與密碼"); return; }
        this.setStatus("登入中…");
        FirebaseService.signIn(e, p)
            .then(() => { this.setStatus("登入成功"); this.goNext(); })
            .catch((err) => this.setStatus("登入失敗：" + this.msg(err)));
    }

    onSignUp() {
        const e = this.val(this.emailInput);
        const p = this.val(this.passwordInput);
        const n = this.val(this.nameInput);
        if (!e || !p) { this.setStatus("請輸入 Email 與密碼"); return; }
        if (p.length < 6) { this.setStatus("密碼至少 6 碼"); return; }
        this.setStatus("註冊中…");
        FirebaseService.signUp(e, p, n)
            .then(() => { this.setStatus("註冊成功"); this.goNext(); })
            .catch((err) => this.setStatus("註冊失敗：" + this.msg(err)));
    }

    onLogout() {
        FirebaseService.signOut().then(() => this.setStatus("已登出"));
    }

    private goNext() {
        if (this.nextScene) cc.director.loadScene(this.nextScene);
    }
    private val(b: cc.EditBox): string { return b ? (b.string || "").trim() : ""; }
    private setStatus(s: string) { if (this.statusLabel) this.statusLabel.string = s; cc.log("[Auth]", s); }
    private msg(err: any): string { return (err && err.message) ? err.message : String(err); }
}