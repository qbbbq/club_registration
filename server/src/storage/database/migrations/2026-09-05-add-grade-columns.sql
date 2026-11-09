-- Run this file with the target database selected, for example:
-- mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" < this-file.sql

-- Do not silently merge two historical registrations that become the same
-- identity after trimming and normalizing a trailing lowercase x.
-- If SIGNAL aborts a fail-fast client, rerun this file to remove the procedure;
-- do not force execution past the failed preflight.
DROP PROCEDURE IF EXISTS assert_id_card_normalization_safe;
DELIMITER $$
CREATE PROCEDURE assert_id_card_normalization_safe()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT UPPER(TRIM(id_card)) AS canonical_id
      FROM students
      GROUP BY UPPER(TRIM(id_card))
      HAVING COUNT(*) > 1
    ) AS duplicate_students
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '学生身份证号规范化后存在重复记录，请先人工处理';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM registrations r
    WHERE NOT EXISTS (
      SELECT 1
      FROM students s
      WHERE r.id_card_hash IN (
        SHA2(s.id_card, 256),
        SHA2(UPPER(s.id_card), 256),
        SHA2(TRIM(s.id_card), 256),
        SHA2(LOWER(TRIM(s.id_card)), 256),
        SHA2(UPPER(TRIM(s.id_card)), 256)
      )
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '存在无法关联到学生的历史报名，请先人工处理';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT UPPER(TRIM(s.id_card)) AS canonical_id
      FROM registrations r
      JOIN students s
        ON r.id_card_hash IN (
          SHA2(s.id_card, 256),
          SHA2(UPPER(s.id_card), 256),
          SHA2(TRIM(s.id_card), 256),
          SHA2(LOWER(TRIM(s.id_card)), 256),
          SHA2(UPPER(TRIM(s.id_card)), 256)
        )
      GROUP BY UPPER(TRIM(s.id_card))
      HAVING COUNT(*) > 1
    ) AS duplicate_registrations
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '学生身份证号规范化后存在重复报名，请先人工处理';
  END IF;
END$$
DELIMITER ;

CALL assert_id_card_normalization_safe();
DROP PROCEDURE IF EXISTS assert_id_card_normalization_safe;

SET @add_club_grade = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE clubs ADD COLUMN grade VARCHAR(10) NULL AFTER name',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'clubs'
    AND column_name = 'grade'
);
PREPARE stmt FROM @add_club_grade;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Canonicalize legacy registration hashes before the application normalizes
-- whitespace and a trailing lowercase x to uppercase X.
UPDATE registrations r
JOIN students s
  ON r.id_card_hash IN (
    SHA2(s.id_card, 256),
    SHA2(UPPER(s.id_card), 256),
    SHA2(TRIM(s.id_card), 256),
    SHA2(LOWER(TRIM(s.id_card)), 256),
    SHA2(UPPER(TRIM(s.id_card)), 256)
  )
SET r.id_card_hash = SHA2(UPPER(TRIM(s.id_card)), 256)
WHERE r.id_card_hash <> SHA2(UPPER(TRIM(s.id_card)), 256);

UPDATE students
SET id_card = UPPER(TRIM(id_card))
WHERE BINARY id_card <> BINARY UPPER(TRIM(id_card));

SET @add_student_grade = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE students ADD COLUMN grade VARCHAR(10) NULL AFTER class_name',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'students'
    AND column_name = 'grade'
);
PREPARE stmt FROM @add_student_grade;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
