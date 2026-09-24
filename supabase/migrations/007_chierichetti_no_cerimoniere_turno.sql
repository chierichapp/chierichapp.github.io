-- I chierichetti non possono essere «cerimoniere di turno».
update public.chierichetti
set cerimoniere_turno = false
where cerimoniere_turno is distinct from false;
