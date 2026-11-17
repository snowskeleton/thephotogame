-- Join codes used to be 4 letters, few enough to guess. Give any short code a random 12-character one
-- (new games get 10 characters from a 31-letter alphabet; see randomCode in game.ts).
UPDATE game SET code = upper(hex(randomblob(6))) WHERE length(code) < 10;
