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

        const db = firebase.firestore();
        const userRef = db.collection("users").doc(u.uid);

        // 使用 Transaction (交易) 確保讀取目前的連勝與勝場進行正確累加
        return db.runTransaction((transaction: any) => {
            return transaction.get(userRef).then((doc: any) => {
                // 如果是新玩家，給予預設值
                const data = doc.exists ? doc.data() : {};
                let wins = data.wins || 0;
                let totalGames = data.totalGames || 0;
                let currentStreak = data.currentStreak || 0;
                let maxStreak = data.maxStreak || 0;

                // 局數必定 +1
                totalGames += 1;

                if (isWin) {
                    wins += 1;
                    currentStreak += 1; // 連勝增加
                    if (currentStreak > maxStreak) {
                        maxStreak = currentStreak; // 破最高連勝紀錄
                    }
                } else {
                    currentStreak = 0; // 輸了，當前連勝直接無情歸零
                }

                // 計算勝率 (四捨五入到小數點後第一位，乘上 100 方便存成百分比數字)
                const winRate = Math.round((wins / totalGames) * 1000) / 10;

                // 寫回資料庫
                transaction.set(userRef, {
                    wins: wins,
                    totalGames: totalGames,
                    winRate: winRate,
                    currentStreak: currentStreak,
                    maxStreak: maxStreak
                }, { merge: true });
            });
        }).catch((e: any) => cc.warn("[Firebase] 遊戲結果結算失敗", e));
    }
}