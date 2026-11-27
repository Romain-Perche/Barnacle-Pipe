-- SF-127 AI review data (on top of the seed): organisations, people and deals for every linking case.
-- Users: Ada Fake (1, admin), Grace Fake (2), Linus Fake (3, plays the spec's "Bob").
insert into organisations (name, owner_id, created_by) values ('Example Ltd',1,1),('Other Co',1,1),('Pia Org',1,1),('Mover Org',1,1),('Gone Org',1,1);
create temp table o as select id, name from organisations where name in ('Example Ltd','Other Co','Pia Org','Mover Org','Gone Org');
insert into persons (first_name,last_name,organisation_id,owner_id,created_by,private,archived_at,last_contacted_at) values
 ('Ana','Example',(select id from o where name='Example Ltd'),1,1,false,null,'2026-11-20 10:00+00'),
 ('Ben','Example',(select id from o where name='Other Co'),1,1,false,null,null),
 ('Pia','Private',(select id from o where name='Pia Org'),1,1,true,null,null),
 ('Cat','Twodeals',null,1,1,false,null,null),
 ('Dan','Closed',null,1,1,false,null,null),
 ('Eve','Linked',null,1,1,false,null,null),
 ('Fay','Pdeal',null,1,1,false,null,null),
 ('Gus','Mover',(select id from o where name='Example Ltd'),1,1,false,null,null),
 ('Hal','Archived',null,1,1,false,now(),null),
 ('Ivy','Later',null,1,1,false,null,null),
 ('Jo','Gone',(select id from o where name='Gone Org'),1,1,false,null,null),
 ('Kim','Twoaddr',null,1,1,false,null,null);
create temp table pp as select id, first_name as n from persons where last_name in ('Example','Private','Twodeals','Closed','Linked','Pdeal','Mover','Archived','Later','Gone','Twoaddr') and first_name in ('Ana','Ben','Pia','Cat','Dan','Eve','Fay','Gus','Hal','Ivy','Jo','Kim');
insert into person_emails (person_id,email,kind,position) values
 ((select id from pp where n='Ana'),'ana@example.test','work',0),((select id from pp where n='Ana'),'ana.example@mail.test','personal',1),
 ((select id from pp where n='Ben'),'ben@example.test','work',0),((select id from pp where n='Pia'),'pia@example.test','work',0),
 ((select id from pp where n='Cat'),'cat@example.test','work',0),((select id from pp where n='Dan'),'dan@example.test','work',0),
 ((select id from pp where n='Eve'),'eve@example.test','work',0),((select id from pp where n='Fay'),'fay@example.test','work',0),
 ((select id from pp where n='Gus'),'gus@example.test','work',0),((select id from pp where n='Hal'),'hal@example.test','work',0),
 ((select id from pp where n='Ivy'),'ivy@example.test','work',0),((select id from pp where n='Jo'),'jo@example.test','work',0),
 ((select id from pp where n='Kim'),'kim@example.test','work',0),((select id from pp where n='Kim'),'kim2@example.test','personal',1);
insert into deals (title,stage_id,person_id,organisation_id,owner_id,created_by,private,status,archived_at,closed_at,lost_reason) values
 ('Example Ltd – pilot',1,(select id from pp where n='Ana'),(select id from o where name='Example Ltd'),1,1,false,'open',null,null,null),
 ('Other Co – renewal',1,(select id from pp where n='Ben'),(select id from o where name='Other Co'),1,1,false,'open',null,null,null),
 ('Cat D1',1,(select id from pp where n='Cat'),null,1,1,false,'open',null,null,null),
 ('Cat D2',1,null,null,1,1,false,'open',null,null,null),
 ('Dan Won',1,(select id from pp where n='Dan'),null,1,1,false,'won',null,now(),null),
 ('Dan Lost',1,(select id from pp where n='Dan'),null,1,1,false,'lost',null,now(),'Price'),
 ('Dan Arch',1,(select id from pp where n='Dan'),null,1,1,false,'open',now(),null,null),
 ('Eve Deal',1,null,null,1,1,false,'open',null,null,null),
 ('Fay Private Deal',1,(select id from pp where n='Fay'),null,1,1,true,'open',null,null,null),
 ('Ada Secret Deal',1,null,null,1,1,true,'open',null,null,null),
 ('Ivy Deal',1,(select id from pp where n='Ivy'),null,1,1,false,'open',null,null,null),
 ('Jo Deal',1,(select id from pp where n='Jo'),null,1,1,false,'open',null,null,null);
insert into deal_people (deal_id,person_id) values
 ((select id from deals where title='Cat D2'),(select id from pp where n='Cat')),
 ((select id from deals where title='Eve Deal'),(select id from pp where n='Eve'));
update gmail_connections set connected_at = '2026-11-01 00:00+00'; -- older emails (US6) are copied too
