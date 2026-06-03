# 設計環形地圖 + 翹翹板

這部分主要是在編輯器裡搭場景,我給你完整步驟。
A. 環形(封閉)地面碰撞
關鍵觀念:Box2D 的多邊形碰撞器必須是凸的,沒辦法用一個多邊形做出「環」。所以環形軌道要用下面其中一種:
做法一(推薦,最平滑)——用 PhysicsChainCollider(鏈狀碰撞器):

建一個節點 Track,加 RigidBody,Type 設 Static,group 設 default 或 BOUNDARY(WallRide 只認這兩種當地面)。
在它上面加 PhysicsChainCollider。把 Points 沿著你要的賽道輪廓一點一點描出來,勾選 Loop = true 讓首尾相接成封閉圈。
環形賽道其實要描兩條鏈:外圈一條、內圈一條(車在兩圈之間的環狀通道裡跑)。可以用兩個 PhysicsChainCollider,或兩個 Track 節點。

做法二(簡單,適合方形迴圈)——用多個方塊拼:

用一堆 PhysicsBoxCollider(或多個方形節點各自帶 collider)拼出地板、牆、天花板,圍成一圈封閉走道。轉角用斜放的方塊或小段拼出弧度。group 一樣設 default/BOUNDARY。

兩種做法都要確保:通道是封閉的、車不會從縫隙掉出去;WALLRIDE.PROBE(90)要大於車子半高,車才探得到腳下的地面。先做一小段「平地→垂直牆→上緣轉角」測 WallRide,再接成整圈。
B. 翹翹板(蹺蹺板)物件
翹翹板 = 一塊會繞中心軸傾斜的板子,用 RevoluteJoint 接到一個固定支點:

建支點節點 SeesawPivot,加 RigidBody Type=Static(不用碰撞器,只當錨點),放在翹翹板中心下方。
建板子節點 SeesawPlank,加 RigidBody Type=Dynamic、加 PhysicsBoxCollider(長條形),group 設 default(這樣車可以開上去,WallRide 也認得它當地面)。
在 SeesawPivot 上加 RevoluteJoint:

Connected Body 拖入 SeesawPlank 的 RigidBody。
Anchor 設在支點位置(板子的旋轉中心)。
勾 Enable Limit,Lower Angle / Upper Angle 設成例如 -25 / 25 度,限制傾斜範圍。
不要開 Motor —— 讓它靠車子的重量自然壓下、另一端翹起。


(可選)板子質量別太輕,否則車一上去就翻太快;調 RigidBody 的 Density 或在板子兩端各放一點配重。

這樣車開上翹翹板一端,那端會下沉、另一端翹起,可以把車彈上高處——配合你的環形賽道很適合做關卡機關。
要的話我可以幫你寫一個小小的 Seesaw 元件(例如自動回正、或限制回彈速度),或一個程式生成環形 PhysicsChainCollider 的工具腳本(直接用程式鋪出一整圈,不用手點幾百個點)