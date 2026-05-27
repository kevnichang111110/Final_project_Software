const { ccclass, property } = cc._decorator;

@ccclass
export default class MenuManager extends cc.Component {

    // 如果你有做 Setting 的 Prefab，可以拖到這裡，但我們先做基本跳轉
    @property(cc.Prefab)
    settingPrefab: cc.Prefab = null;

    onLoad() {
        // 可以在這裡播放背景音樂
    }


    onPlayButtonClick() {
        cc.director.loadScene("SelectMode");
    }

    onLeaderboardButtonClick() {
        cc.director.loadScene("Leaderboard");
    }

    onSettingButtonClick() {
        if (this.settingPrefab) {
            let settingNode = cc.instantiate(this.settingPrefab);
            this.node.addChild(settingNode);
        } else {
            console.log("尚未設定 Setting Prefab");
        }
    }
    Singleplayer() {
        cc.director.loadScene("Shop");
    }
    Multiplayer() {
        cc.director.loadScene("Shop");
    }
}