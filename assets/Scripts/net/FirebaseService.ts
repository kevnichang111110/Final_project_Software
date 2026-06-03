// net/FirebaseService.ts
// Firebase 帳號 / 排行榜服務層（Cocos Creator 2.x 用 compat 版 SDK）。
//
// 使用前置作業（詳見對話說明）：
//   1. Firebase 後台建立專案，開啟 Authentication 的 Email/Password，建立 Firestore 資料庫。
//   2. 把後台給的網頁設定貼到下面 FIREBASE_CONFIG。
//   3. 在 build 模板的 index.html 裡用 <script> 載入 firebase-app/auth/firestore 的 compat SDK。
//
// 全部方法都對「SDK 未載入 / 尚未登入」做了防呆，不會讓遊戲整個壞掉。

declare const firebase: any;

// ⬇⬇⬇ 換成你 Firebase 後台「專案設定 → 你的應用程式」給的設定 ⬇⬇⬇
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
};
// ⬆⬆⬆ ⬆⬆⬆

export interface LeaderRow { name: string; wins: number; bestScore: number; }

export default class FirebaseService {
    private static inited = false;
    private static authReady = false;
    private static user: any = null;
    private static listeners: ((u: any) => void)[] = [];

    /** 在登入場景 / 排行榜場景的 onLoad 呼叫一次即可（重複呼叫安全） */
    static init() {
        if (this.inited) return;
        if (typeof firebase === "undefined") {
            cc.warn("[Firebase] 找不到 firebase：請確認 index.html 已載入 Firebase CDN <script>");
            return;
        }
        try {
            if (!firebase.apps || !firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            this.inited = true;
            firebase.auth().onAuthStateChanged((u: any) => {
                this.user = u;
                this.authReady = true;
                this.listeners.forEach(cb => { try { cb(u); } catch (e) { /* ignore */ } });
            });
            cc.log("[Firebase] 初始化完成");
        } catch (e) {
            cc.error("[Firebase] 初始化失敗", e);
        }
    }

    static isReady(): boolean { return this.inited && typeof firebase !== "undefined"; }
    static getUser(): any { return this.user; }
    static isLoggedIn(): boolean { return !!this.user; }

    /** 監聽登入狀態變化（若已知狀態會立刻回呼一次） */
    static onAuthChanged(cb: (u: any) => void) {
        this.listeners.push(cb);
        if (this.authReady) cb(this.user);
    }

    /** 註冊：建立帳號並在 Firestore 建立該玩家的資料列 */
    static signUp(email: string, password: string, displayName: string): Promise<any> {
        if (!this.isReady()) return Promise.reject(new Error("Firebase 未就緒"));
        return firebase.auth().createUserWithEmailAndPassword(email, password)
            .then((cred: any) => {
                const uid = cred.user.uid;
                const name = displayName || email.split("@")[0];
                return firebase.firestore().collection("users").doc(uid).set({
                    name: name,
                    wins: 0,
                    bestScore: 0,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, { merge: true }).then(() => cred);
            });
    }

    static signIn(email: string, password: string): Promise<any> {
        if (!this.isReady()) return Promise.reject(new Error("Firebase 未就緒"));
        return firebase.auth().signInWithEmailAndPassword(email, password);
    }

    static signOut(): Promise<any> {
        if (!this.isReady()) return Promise.resolve();
        return firebase.auth().signOut();
    }

    /** 贏得一場比賽 → 累積勝場 +1 */
    static incrementWins(): Promise<any> {
        const u = this.user;
        if (!this.isReady() || !u) return Promise.resolve();
        return firebase.firestore().collection("users").doc(u.uid)
            .set({ wins: firebase.firestore.FieldValue.increment(1) }, { merge: true })
            .catch((e: any) => cc.warn("[Firebase] 勝場更新失敗", e));
    }

    /** 只有破紀錄才更新最佳分數（用交易避免覆蓋成更低分） */
    static submitBestScore(score: number): Promise<any> {
        const u = this.user;
        if (!this.isReady() || !u) return Promise.resolve();
        const ref = firebase.firestore().collection("users").doc(u.uid);
        return firebase.firestore().runTransaction((tx: any) =>
            tx.get(ref).then((doc: any) => {
                const cur = (doc.exists && doc.data().bestScore) || 0;
                if (score > cur) tx.set(ref, { bestScore: score }, { merge: true });
            })
        ).catch((e: any) => cc.warn("[Firebase] 分數更新失敗", e));
    }

    /** 取排行榜（依勝場由多到少） */
    static getLeaderboard(limit: number = 20): Promise<LeaderRow[]> {
        if (!this.isReady()) return Promise.resolve([]);
        return firebase.firestore().collection("users")
            .orderBy("wins", "desc").limit(limit).get()
            .then((snap: any) => {
                const out: LeaderRow[] = [];
                snap.forEach((d: any) => {
                    const v = d.data();
                    out.push({ name: v.name || "玩家", wins: v.wins || 0, bestScore: v.bestScore || 0 });
                });
                return out;
            });
    }
}