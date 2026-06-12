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

const firebaseConfig = {
  apiKey: "AIzaSyBdHqeN74jrRglDMcyybgPqkA45rYrzEAM",
  authDomain: "ssdfinal-c6446.firebaseapp.com",
  projectId: "ssdfinal-c6446",
  storageBucket: "ssdfinal-c6446.firebasestorage.app",
  messagingSenderId: "429751554635",
  appId: "1:429751554635:web:cfdc5b61ece62bb65ef3ce"
};
// ⬆⬆⬆ ⬆⬆⬆

export interface LeaderRow { 
    name: string; 
    avatarId: number;
    winRate: number;       // 勝率 (0 ~ 100)
    currentStreak: number; // 當前連勝
    maxStreak: number;     // 最高連勝
}

export default class FirebaseService {
    private static inited = false;
    private static authReady = false;
    private static user: any = null;
    private static listeners: ((u: any) => void)[] = [];

    /** 在登入場景 / 排行榜場景的 onLoad 呼叫一次即可（重複呼叫安全） */
   /** 在登入場景 / 排行榜場景的 onLoad 呼叫一次即可（重複呼叫安全） */
    static init() {
        if (this.inited) return;
        
        // 【修改】更新防呆警告文字，符合目前的插件作法
        if (typeof firebase === "undefined") {
            cc.warn("[Firebase] 找不到 firebase：請確認 firebase-compat.min.js 已放入專案並勾選為「導入為插件 (Import As Plugin)」");
            return;
        }
        
        try {
            if (!firebase.apps || !firebase.apps.length) {
                firebase.initializeApp(firebaseConfig); // 記得填寫你的 CONFIG
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

   static getLeaderboard(limit: number = 20): Promise<LeaderRow[]> {
        console.log("【REST API】開始抓取勝率排行榜...");
        const projectId = "ssdfinal-c6446"; 
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`;
        
        return fetch(url)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(data => {
                const out: LeaderRow[] = [];
                if (data.documents) {
                    data.documents.forEach((doc: any) => {
                        if (doc.fields) {
                            const name = doc.fields.name ? doc.fields.name.stringValue : "玩家";
                            
                            // 解析數值防呆 (處理 integerValue 或 doubleValue)
                            const avatarId = doc.fields.avatarId && doc.fields.avatarId.integerValue ? parseInt(doc.fields.avatarId.integerValue) : 0;
                            
                            const winRate = doc.fields.winRate ? 
                                parseFloat(doc.fields.winRate.doubleValue || doc.fields.winRate.integerValue || "0") : 0;
                                
                            const currentStreak = doc.fields.currentStreak && doc.fields.currentStreak.integerValue ? 
                                parseInt(doc.fields.currentStreak.integerValue) : 0;
                                
                            const maxStreak = doc.fields.maxStreak && doc.fields.maxStreak.integerValue ? 
                                parseInt(doc.fields.maxStreak.integerValue) : 0;

                            out.push({ name, avatarId, winRate, currentStreak, maxStreak });
                        }
                    });
                }
                
                // 排行榜權重：優先看【勝率】由高到低，若勝率相同則看【最高連勝】
                out.sort((a, b) => {
                    if (b.winRate === a.winRate) return b.maxStreak - a.maxStreak;
                    return b.winRate - a.winRate;
                });
                
                return out.slice(0, limit);
            })
            .catch(err => { console.error(err); return []; });
    }

   static updateGameResult(isWin: boolean): Promise<any> {
        const u = this.user;
        if (!this.isReady() || !u) return Promise.resolve();

        console.log("【REST API】準備結算戰績... 本局獲勝：", isWin);
        const projectId = "ssdfinal-c6446";
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${u.uid}`;

        // 1. 先去抓舊資料
        return fetch(url)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                let wins = 0, totalGames = 0, currentStreak = 0, maxStreak = 0;
                let name = "未命名玩家";
                let avatarId = 0;

                // 2. 如果資料庫有舊資料，就讀出來
                if (data && data.fields) {
                    if (data.fields.wins) wins = parseInt(data.fields.wins.integerValue || data.fields.wins.doubleValue || "0");
                    if (data.fields.totalGames) totalGames = parseInt(data.fields.totalGames.integerValue || data.fields.totalGames.doubleValue || "0");
                    if (data.fields.currentStreak) currentStreak = parseInt(data.fields.currentStreak.integerValue || data.fields.currentStreak.doubleValue || "0");
                    if (data.fields.maxStreak) maxStreak = parseInt(data.fields.maxStreak.integerValue || data.fields.maxStreak.doubleValue || "0");
                    if (data.fields.name) name = data.fields.name.stringValue || "未命名玩家";
                    if (data.fields.avatarId) avatarId = parseInt(data.fields.avatarId.integerValue || "0");
                }

                // 3. 結算新戰績
                totalGames += 1;
                if (isWin) {
                    wins += 1;
                    currentStreak += 1;
                    if (currentStreak > maxStreak) maxStreak = currentStreak; // 破紀錄
                } else {
                    currentStreak = 0; // 輸了歸零
                }

                const winRate = Math.round((wins / totalGames) * 1000) / 10;

                // 4. 用 PATCH 把資料強制寫入 (如果檔案不存在，PATCH 會自動幫你建立！)
                const patchUrl = `${url}?updateMask.fieldPaths=wins&updateMask.fieldPaths=totalGames&updateMask.fieldPaths=winRate&updateMask.fieldPaths=currentStreak&updateMask.fieldPaths=maxStreak&updateMask.fieldPaths=name&updateMask.fieldPaths=avatarId`;
                
                return fetch(patchUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            name: { stringValue: name },
                            avatarId: { integerValue: avatarId },
                            wins: { integerValue: wins },
                            totalGames: { integerValue: totalGames },
                            winRate: { doubleValue: winRate },
                            currentStreak: { integerValue: currentStreak },
                            maxStreak: { integerValue: maxStreak }
                        }
                    })
                });
            })
            .then(res => {
                if (!res.ok) throw new Error("寫入失敗");
                return res.json();
            })
            .then(res => {
                console.log("✅ 戰績成功寫入 Firebase！");
                return res;
            });
    }
}