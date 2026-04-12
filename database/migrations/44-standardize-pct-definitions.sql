-- Standardize all particlesandclassifiers definitions to use
-- "classifier for X" or "particle for X" format for consistency
-- and learner-friendliness.

-- ── Classifier outliers ───────────────────────────────────────────────────────

UPDATE particlesandclassifiers
SET definition = 'classifier for any noun (general-purpose)'
WHERE character = '个' AND language = 'zh' AND type = 'classifier';

UPDATE particlesandclassifiers
SET definition = 'classifier for Tibetan land area units'
WHERE character = '克' AND language = 'zh' AND type = 'classifier';

UPDATE particlesandclassifiers
SET definition = 'classifier for grain in shi units (ten dou)'
WHERE character = '石' AND language = 'zh' AND type = 'classifier';

UPDATE particlesandclassifiers
SET definition = 'classifier for weight in qian units (one tenth tael)'
WHERE character = '钱' AND language = 'zh' AND type = 'classifier';

-- ── Particles ─────────────────────────────────────────────────────────────────

UPDATE particlesandclassifiers
SET definition = 'particle for possession and description'
WHERE character = '之' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for questions and tone'
WHERE character = '乎' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for making statements and emphasis'
WHERE character = '也' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for completed actions'
WHERE character = '了' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for yes-no questions'
WHERE character = '吗' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for suggestions or guesses'
WHERE character = '吧' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for resigned or obvious tone'
WHERE character = '呗' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for follow-up questions or affirmation'
WHERE character = '呢' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for exclamation or emphasis'
WHERE character = '咧' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for obvious or expected results'
WHERE character = '咯' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for exclamation and rhetoric'
WHERE character = '哉' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for gentle commands or exclamations'
WHERE character = '哟' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for warm or realizing tone'
WHERE character = '哦' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for softening or listing'
WHERE character = '啦' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for stating the obvious'
WHERE character = '嘛' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for describing how an action is done (adverb)'
WHERE character = '地' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for what is seen, done, or experienced'
WHERE character = '所' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for placing the object before the verb'
WHERE character = '把' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for possession and describing things'
WHERE character = '的' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for marking completion'
WHERE character = '矣' AND language = 'zh' AND type = 'particle';

UPDATE particlesandclassifiers
SET definition = 'particle for having done something'
WHERE character = '过' AND language = 'zh' AND type = 'particle';
