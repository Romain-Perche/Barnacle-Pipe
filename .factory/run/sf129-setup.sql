-- SF-129 AI review data (on top of the seed). Users: Ada Fake (1, connected fake Gmail), Grace Fake (2, admin, no Gmail),
-- Linus Fake (3), Margaret Fake (4, the teammate who cannot see Pia's private person).
insert into organisations (name, owner_id, created_by) values ('Fake Org Ltd',1,1),('Lone Org Ltd',1,1),('Arch Org Ltd',1,1);
create temp table o as select id, name from organisations where name in ('Fake Org Ltd','Lone Org Ltd','Arch Org Ltd');
insert into persons (first_name,last_name,organisation_id,owner_id,created_by,private,consent,last_contacted_at) values
 ('Ana','Fake',(select id from o where name='Fake Org Ltd'),1,1,false,'subscribed','2026-11-20 10:00+00'),
 ('Ben','Fake',null,1,1,false,'subscribed',null),
 ('Zed','Drawer',null,1,1,false,'subscribed',null),
 ('Pia','Private',null,1,1,true,'subscribed',null),
 ('Nemo','Noemail',null,1,1,false,'subscribed',null),
 ('Gia','Hidden',null,2,2,true,'subscribed',null),
 ('Una','Unsub',null,1,1,false,'unsubscribed',null),
 ('Fio','Files',null,1,1,false,'subscribed',null),
 ('Lex','Later',null,1,1,false,'subscribed','2027-06-01 10:00+00'),
 ('Ari','Archme',null,1,1,false,'subscribed',null),
 ('Del','Deleteme',null,1,1,false,'subscribed',null);
create temp table pp as select id, first_name as n from persons where (first_name,last_name) in (('Ana','Fake'),('Ben','Fake'),('Zed','Drawer'),('Pia','Private'),('Nemo','Noemail'),('Gia','Hidden'),('Una','Unsub'),('Fio','Files'),('Lex','Later'),('Ari','Archme'),('Del','Deleteme'));
insert into person_emails (person_id,email,kind,position) values
 ((select id from pp where n='Ana'),'ana@example.test','work',0),((select id from pp where n='Ana'),'ana.k@example.test','personal',1),
 ((select id from pp where n='Ben'),'ben@example.test','work',0),((select id from pp where n='Zed'),'zed@example.test','work',0),
 ((select id from pp where n='Pia'),'pia@example.test','work',0),((select id from pp where n='Gia'),'gia@example.test','work',0),
 ((select id from pp where n='Una'),'una@example.test','work',0),((select id from pp where n='Fio'),'fio@example.test','work',0),
 ((select id from pp where n='Lex'),'lex@example.test','work',0),((select id from pp where n='Ari'),'ari@example.test','work',0),
 ((select id from pp where n='Del'),'del@example.test','work',0);
insert into deals (title,stage_id,person_id,organisation_id,owner_id,created_by,private,status) values
 ('Fake Deal Ltd renewal',1,(select id from pp where n='Ana'),(select id from o where name='Fake Org Ltd'),1,1,false,'open'),
 ('Zed drawer deal',1,(select id from pp where n='Zed'),null,1,1,false,'open'),
 ('NoPerson deal',1,null,null,1,1,false,'open'),
 ('NoEmail deal',1,(select id from pp where n='Nemo'),null,1,1,false,'open'),
 ('HiddenPerson deal',1,(select id from pp where n='Gia'),null,1,1,false,'open'),
 ('Una deal',1,(select id from pp where n='Una'),null,1,1,false,'open'),
 ('Files deal',1,(select id from pp where n='Fio'),null,1,1,false,'open'),
 ('Arch deal',1,null,null,1,1,false,'open'),
 ('Hide deal',1,null,null,3,3,false,'open'),
 ('Delete deal',1,null,null,1,1,false,'open'),
 ('Later arch deal',1,null,null,1,1,false,'open'),
 ('Later del deal',1,(select id from pp where n='Del'),null,1,1,false,'open'),
 ('Unlink deal',1,null,null,1,1,false,'open'),
 ('Pia deal',1,null,null,1,1,false,'open');
