# Mitgelieferte ICC-Druckprofile

Diese Profile stehen **nicht** unter der MIT-Lizenz von Lichtjahr, sondern unter der zlib/libpng-Lizenz
von basICColor GmbH (Text in `LICENSE-basICColor.txt`; er darf nicht entfernt oder verändert werden).
Die Dateien sind unverändert.

| Datei | Druckbedingung | Gesamtfarbauftrag | Quelle |
|---|---|---|---|
| `ISOcoated_v2_300_bas.icc` | FOGRA39L, gestrichenes Papier | 300 % | Scribus `resources/profiles/`, Debian `icc-profiles-free` (byte-gleich, SHA-256 `b424c77f…7e886`) |
| `PSO_Uncoated_ISO12647_bas.icc` | FOGRA47L, ungestrichenes Papier | 300 % | Debian `icc-profiles-free`, `icc-profiles-basiccolor-printing2009` |

Andere verbreitete Profile dürfen nicht mitgeliefert, aber von jedem selbst geladen und in Lichtjahr als
eigenes Druckprofil hinzugefügt werden (die Lizenzen erlauben das Einbetten ins PDF):

- **PSO Coated v3** (FOGRA51), **PSO Uncoated v3** (FOGRA52), **ISO Coated v2 (ECI)** (FOGRA39):
  European Color Initiative, <https://eci.org/doku.php_id=en_downloads.html>
- **Coated FOGRA39** von Adobe: <https://www.adobe.com/support/downloads/iccprofiles/>

Am besten nimmt man das Profil, das die Druckerei in ihren Druckdaten-Hinweisen nennt.
