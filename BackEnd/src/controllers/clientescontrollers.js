import { db } from "../config/config.js";
import {bcrypt} from "bcryptjs"

export async function criarUsuario(req, res) {
    try {
        const { 
            nome, 
            email, 
            senha, 
            primeiracompra } = req.body
        if (!nome || !email || !senha || !primeiracompra === undefined)
            return res.status(400).json({ erro: "Campos obrigatórios" });
        if (nome.length < 2 || nome.length > 200){
            return res.status(400).json({erro: "O Nome deve ter entre 2 e 200 caracteres"});
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
            return res.status(400).json({erro: "O E-mail deve seguir o padrão!"});
        }
        if (senha.length < 6){
            return res.status(400).json({erro: "A senha deve ter no minímo 6 dígitos"});
        }
        const [existingUser] = await db.execute(
            "SELECT ID_Cliente FROM TbClientes WHERE Email = ?", 
            [email.toLowerCase()]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ 
                erro: "E-mail já está em uso" 
            });
        }
        const senhaHash = await bcrypt.hash(senha, 12);
        const [result] = await db.execute(
            "INSERT INTO TbClientes (Nome, Email, Senha, Primeira_Compra) VALUES (?, ?, ?, ?)",
            [nome.trim(), email.toLowerCase(), senhaHash, primeira_compra]
        );
        res.status(201).json({
            mensagem: "Usuário criado com sucesso",
            id: result.insertId
        });
        res.json({ mensagem: "Usuario criado com sucesso" });
    } catch (err) {
    res.status(500).json({ erro: err.message });
    }
}
