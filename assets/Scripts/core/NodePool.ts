// core/NodePool.ts
// 極簡通用節點池：用「回收再利用」取代頻繁的 cc.instantiate / new cc.Node + destroy()，
// 降低戰鬥中（子彈、爆炸、火花）的記憶體配置與 GC 壓力。
//
// 設計重點：
//   - factory：池子空了才呼叫，負責生出一個全新節點（prefab 實例或程式組出的子樹）。
//   - put()：把節點「停動作、脫離父層、設為 inactive」後收回，但「不」destroy。
//            刻意脫離場景樹 → 換場景時不會被一起銷毀，池子得以跨回合 / 跨場景存活。
//   - get()：優先取回收的節點，沒有才用 factory 生新的。呼叫端自行 re-parent / active / 重設狀態。
//
// 池子實例通常以 module-level singleton 持有，這樣回合重來、場景重載後仍能繼續重用。

export default class NodePool {
    private free: cc.Node[] = [];

    constructor(private factory: () => cc.Node) {}

    // 取一個節點（回收的或新生的）。呼叫端負責 active = true、設定 parent / 位置 / 狀態。
    get(): cc.Node {
        const n = this.free.pop();
        return n && n.isValid ? n : this.factory();
    }

    // 收回節點：停掉所有 tween/動作、脫離父層、設為 inactive，放回空閒清單。
    put(node: cc.Node): void {
        if (!node || !node.isValid) return;
        node.stopAllActions();
        node.removeFromParent();   // 脫離場景樹，避免換場景時被連帶銷毀
        node.active = false;
        this.free.push(node);
    }

    // 預先生出 n 個節點放進池子，攤平第一波尖峰的配置成本。
    prewarm(n: number): void {
        for (let i = 0; i < n; i++) this.put(this.factory());
    }

    // 目前空閒（可立即重用）的節點數，除錯用。
    get freeCount(): number {
        return this.free.length;
    }
}
