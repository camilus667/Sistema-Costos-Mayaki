const http = require('http');
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', '..', 'sales_export_1785766504622_desde2025.xlsx');
const fileBuffer = fs.readFileSync(filePath);

const boundary = '----FormBoundary' + Date.now();

const bodyParts = [
  `--${boundary}\r\n`,
  `Content-Disposition: form-data; name="archivo"; filename="sales_export.xlsx"\r\n`,
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
];

const bodyStart = Buffer.from(bodyParts.join(''), 'utf-8');
const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
const fullBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

const opts = {
  hostname: 'localhost',
  port: 3002,
  path: '/api/sales/importar',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': fullBody.length,
  }
};

const req = http.request(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('1a IMPORT:', d);

    // Ahora ver colegios
    http.get('http://localhost:3002/api/sales/colegios', res2 => {
      let d2 = '';
      res2.on('data', c => d2 += c);
      res2.on('end', () => {
        const parsed = JSON.parse(d2);
        const cambridge1 = parsed.data.find(c => c.colegioGrupo === 'Cambridge');
        console.log('Cambridge tras 1a carga:', cambridge1);

        // 2a importación - debería dar el mismo resultado
        const req2 = http.request(opts, res3 => {
          let d3 = '';
          res3.on('data', c => d3 += c);
          res3.on('end', () => {
            console.log('2a IMPORT:', d3);

            http.get('http://localhost:3002/api/sales/colegios', res4 => {
              let d4 = '';
              res4.on('data', c => d4 += c);
              res4.on('end', () => {
                const parsed2 = JSON.parse(d4);
                const cambridge2 = parsed2.data.find(c => c.colegioGrupo === 'Cambridge');
                console.log('Cambridge tras 2a carga:', cambridge2);

                if (cambridge1.totalVentaBs === cambridge2.totalVentaBs) {
                  console.log('\n✅ ÉXITO: No hay duplicación. Los montos son idénticos.');
                } else {
                  console.log('\n❌ ERROR: Los montos cambiaron (duplicación).');
                }
              });
            });
          });
        });
        req2.write(fullBody);
        req2.end();
      });
    });
  });
});
req.on('error', e => console.error('ERR:', e));
req.write(fullBody);
req.end();
