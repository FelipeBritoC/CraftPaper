console.log("Js rodando!")
const form = document.getElementById("formLogin");

form.addEventListener("submit", (event) => {
    event.preventDefault(); // impede recarregar a página

    const nome = document.getElementById("nome").value;
    const usuario = document.getElementById("usuario").value;
    const senha = document.getElementById("senha").value;

    console.log("Nome:", nome);
    console.log("Usuário:", usuario);
    console.log("Senha:", senha);


    const dadosLogin = {
        nome: nome,
        usuario: usuario,
        senha: senha
    };

    console.log("Objeto enviado:", dadosLogin);
});