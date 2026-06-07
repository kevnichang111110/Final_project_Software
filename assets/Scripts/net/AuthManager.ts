import FirebaseService from "./FirebaseService";

const { ccclass, property } = cc._decorator;

@ccclass
export default class AuthManager extends cc.Component {
    // 【新增】這個用來裝所有的登入輸入框與按鈕
    @property({ type: cc.Node, tooltip: "裝載所有登入介面的容器" })
    loginPanel: cc.Node = null; 

    @property(cc.EditBox) emailInput: cc.EditBox = null;
    @property(cc.EditBox) passwordInput: cc.EditBox = null;
    @property({ type: cc.EditBox, tooltip: "註冊用的顯示名稱" })
    nameInput: cc.EditBox = null;
    @property(cc.Label) statusLabel: cc.Label = null;
    @property({ type: cc.Node, tooltip: "載入中遮罩（擋住畫面防閃爍）" })
    loadingMask: cc.Node = null; 

    @property({ tooltip: "登入/註冊成功後要載入的場景" })
    nextScene: string = "";
    @property({ tooltip: "已登入時是否自動跳到 nextScene" })
    autoSkipIfLoggedIn: boolean = true;

    onLoad() {
        if (this.loadingMask) this.loadingMask.active = true; 

        FirebaseService.init();
        FirebaseService.onAuthChanged((u) => {
            if (this.loadingMask) this.loadingMask.active = false;

            if (u) {
                this.setStatus(`已登入：${u.email || u.uid}`);
                if (this.autoSkipIfLoggedIn) this.goNext();
            } else {
                this.setStatus("請登入或註冊");
                // 【新增】如果沒登入，強制顯示登入面板
                if (this.loginPanel) this.loginPanel.active = true; 
            }
        });
    }

    onLogin() { /* 維持原樣... */
        const e = this.val(this.emailInput);
        const p = this.val(this.passwordInput);
        if (!e || !p) { this.setStatus("請輸入 Email 與密碼"); return; }
        this.setStatus("登入中…");
        FirebaseService.signIn(e, p)
            .then(() => { this.setStatus("登入成功"); this.goNext(); })
            .catch((err) => this.setStatus("登入失敗：" + this.msg(err)));
    }

    onSignUp() { /* 維持原樣... */
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
        // 登出後，狀態改變會自動觸發上方 onAuthChanged，把 loginPanel 顯示回來
        FirebaseService.signOut().then(() => this.setStatus("已登出"));
    }

    private goNext() {
        if (this.nextScene) {
            cc.director.loadScene(this.nextScene);
        } else if (this.loginPanel) {
            // 【修改】登入成功後，隱藏的是子節點 loginPanel
            this.loginPanel.active = false; 
        }
    }
    
    private val(b: cc.EditBox): string { return b ? (b.string || "").trim() : ""; }
    private setStatus(s: string) { if (this.statusLabel) this.statusLabel.string = s; cc.log("[Auth]", s); }
    private msg(err: any): string { 
        if (!err || !err.code) return String(err);
        switch (err.code) {
            case 'auth/invalid-email': return "信箱格式錯誤";
            case 'auth/user-not-found': return "找不到此帳號";
            case 'auth/wrong-password': return "密碼錯誤";
            case 'auth/email-already-in-use': return "此信箱已被註冊";
            case 'auth/weak-password': return "密碼強度太弱（至少 6 碼）";
            default: return err.message;
        }
    }
}