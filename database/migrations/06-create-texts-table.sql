-- Create texts table with language support
CREATE TABLE IF NOT EXISTS texts (
    id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'zh',
    "characterCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Create index for language filtering
CREATE INDEX IF NOT EXISTS idx_texts_language ON texts(language);

-- Insert existing Chinese texts
INSERT INTO texts (id, title, description, content, language, "characterCount", "createdAt") VALUES
('text-001', '咖啡店的早晨', '在咖啡店里度过的美好早晨时光', '今天早上，我来到了市中心的一家小咖啡店。这家店很温馨，墙上挂着许多艺术画作，空气中弥漫着浓郁的咖啡香味。我点了一杯拿铁咖啡和一个牛角包。坐在靠窗的位置，我可以看到街上来来往往的人们。有些人匆匆忙忙地赶去上班，有些人悠闲地散步。咖啡店里播放着轻柔的音乐，让人感到很放松。', 'zh', 150, '2024-12-15T08:00:00Z'),
('text-002', '春节的准备', '家庭为春节做准备的温馨故事', '春节快到了，我们全家都在忙着准备过年。妈妈早早就开始计划年夜饭的菜单，她说今年要做十二道菜，寓意着十二个月都顺顺利利。爸爸负责买年货，他列了一个长长的清单：瓜子、花生、糖果、水果，还有各种干货。我和弟弟的任务是打扫房子和贴春联。', 'zh', 130, '2024-12-10T10:30:00Z'),
('text-003', '公园里的太极', '在公园里练习太极拳的老人们', '每天早上六点，我都会去附近的公园散步。公园里有一群老人在练习太极拳，他们的动作缓慢而优雅，就像在跳一支无声的舞蹈。领头的是一位七十多岁的张爷爷，他练太极已经有三十多年了。他告诉我，太极不仅能强身健体，还能让心情平静。', 'zh', 120, '2024-12-05T06:45:00Z');

-- Insert Japanese sample texts
INSERT INTO texts (id, title, description, content, language, "characterCount", "createdAt") VALUES
('text-ja-001', '朝のカフェ', 'カフェで過ごす素敵な朝の時間', '今朝、私は市内中心部の小さなカフェに行きました。このお店はとても居心地が良く、壁には多くの芸術作品が飾られており、空気には濃厚なコーヒーの香りが漂っていました。私はラテとクロワッサンを注文しました。窓際の席に座ると、通りを行き交う人々が見えました。急いで仕事に行く人もいれば、のんびりと散歩する人もいます。カフェでは穏やかな音楽が流れていて、とてもリラックスできました。', 'ja', 180, NOW()),
('text-ja-002', '桜の季節', '春の桜を楽しむ物語', '春になると、日本中で桜が咲き始めます。私の好きな公園にも、美しい桜の木がたくさんあります。週末に友達と一緒にお花見に行きました。桜の下でお弁当を食べながら、春の訪れを楽しみました。桜の花びらがゆっくりと風に舞い、まるで雪のように見えました。多くの人々が写真を撮ったり、ピクニックを楽しんだりしていました。日本の春は本当に美しいです。', 'ja', 160, NOW()),
('text-ja-003', '書店での出会い', '偶然の出会いから始まる物語', '昨日、私は古い書店を訪れました。この書店は小さいですが、珍しい本がたくさんあります。本棚の間を歩いていると、興味深いタイトルの本を見つけました。それは日本の伝統文化について書かれた本でした。本を手に取ると、隣にいた年配の女性が話しかけてきました。彼女はその本の著者の友人だそうで、本について詳しく教えてくれました。思いがけない出会いに感謝しながら、その本を購入しました。', 'ja', 170, NOW());
