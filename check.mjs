const { all, run, insert } = await import('./newdb.ts');
console.log(all("PRAGMA table_info(photo)").find(c=>c.name==='category_id'));
console.log(all("SELECT * FROM photo"), all("SELECT * FROM photo_claim"), all("SELECT * FROM doubt"));
console.log(all("PRAGMA foreign_key_check"), all("PRAGMA index_list(photo)"));
insert("INSERT INTO photo (game_id,category_id,user_id,team_id,ext,width,height,created_at) VALUES (1,NULL,1,1,'jpg',1,1,2)");
run("DELETE FROM photo WHERE id = 1"); console.log('claims after cascade', all("SELECT * FROM photo_claim"), all("SELECT * FROM doubt"));
console.log(all("SELECT sql FROM sqlite_master WHERE sql LIKE '%photo%' AND type='table'").map(r=>r.sql.split('\n')[0]+' ... '+(r.sql.match(/REFERENCES photo\w*/)||[''])[0]));
