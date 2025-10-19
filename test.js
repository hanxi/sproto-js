var fs = require("fs");
var sproto = require("./dist/sproto.js");

var filename = "./protocol.spb";
var buffer = fs.readFileSync(filename);
if (buffer == null) {
  console.log("read File err1");
}
console.log(sproto);

var sp = sproto.createNew(buffer);
console.log(sp);

let client = sp.host("base.package");
let client_request = client.attach(sp);    //获取一个request请求的回调函数
let data = {
  token: "test",
  ctx: {
    proto_checksum: "xxxxx"
  }
};
let req = client_request("login.login", data);
// req 用于发送给服务器

let ret = client.dispatch(req);    //这个对应于 host:dispatch(req)
console.log("ret", ret);       //打印数据
