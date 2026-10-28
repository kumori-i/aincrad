"""No environment identifiers, labels or renderer metadata enter these policies."""
import math
import torch
from torch import nn
from torch.distributions import Categorical


class Encoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Conv2d(3, 8, 3, 2, 1), nn.ReLU(),
                                    nn.Conv2d(8, 16, 3, 2, 1), nn.ReLU(),
                                    nn.Flatten(), nn.Linear(256, 32), nn.ReLU())

    def forward(self, pixels):
        return self.layers(pixels)


class Sender(nn.Module):
    def __init__(self, alphabet=8, length=2):
        super().__init__()
        self.encoder = Encoder()
        self.alphabet, self.length = alphabet, length
        self.output = nn.Linear(32, alphabet * length)

    def forward(self, pixels):
        return Categorical(logits=self.output(self.encoder(pixels)).reshape(-1, self.length, self.alphabet))


class Receiver(nn.Module):
    def __init__(self, alphabet=8, length=2):
        super().__init__()
        self.encoder = Encoder()  # Never shared with Sender.encoder.
        self.alphabet, self.length = alphabet, length
        self.symbols = nn.Embedding(alphabet * length, 16)
        self.message = nn.Linear(16 * length, 32)
        self.control_query = nn.Parameter(torch.randn(32) * .1)

    def query(self, tokens=None, n=1):
        if tokens is None:
            # Trainable constant query permits genuine receiver-only training.
            # It has no episode-specific information, but gradients remain live.
            query = self.message(torch.zeros(n, 16*self.length)) + self.control_query
        else:
            offsets = torch.arange(self.length) * self.alphabet
            query = self.message(self.symbols(tokens + offsets).flatten(1)) + self.control_query
        return query

    def forward(self, candidates, tokens=None):
        n, k = candidates.shape[:2]
        images = self.encoder(candidates.flatten(0, 1)).reshape(n, k, 32)
        query = self.query(tokens, n)
        return Categorical(logits=(images * query[:, None]).sum(-1) / math.sqrt(32))


def reinforce(sender, receiver, batch, baseline, entropy, marginal_entropy=0.):
    """Shared sampled reward plus label-free entropy biases; no target-index loss."""
    images = torch.from_numpy(batch.candidates)
    if sender is not None:
        message_dist = sender(torch.from_numpy(batch.sender))
        tokens = message_dist.sample()
        sender_log_prob = message_dist.log_prob(tokens).sum(-1)
        sender_entropy = message_dist.entropy().sum(-1).mean()
        marginal = message_dist.probs.mean(0)
        marginal_bonus = -(marginal * marginal.clamp_min(1e-8).log()).sum()
        ids = tokens[:,0]*8+tokens[:,1]
        distinct = int(ids.unique().numel())
        greedy = message_dist.logits.argmax(-1)
        greedy_distinct = int((greedy[:,0]*8+greedy[:,1]).unique().numel())
    else:
        tokens, sender_log_prob, sender_entropy = None, 0, 0
        marginal_bonus, distinct, greedy_distinct = 0, 0, 0
    choices = receiver(images, tokens)
    actions = choices.sample()
    reward = (actions == torch.from_numpy(batch.target)).float()
    advantage = (reward - baseline).detach()
    loss = -(advantage * (choices.log_prob(actions) + sender_log_prob)).mean()
    loss -= entropy * (choices.entropy().mean() + sender_entropy)
    loss -= marginal_entropy * marginal_bonus
    return loss, reward.mean().item(), {'sender_entropy':float(sender_entropy.detach()) if sender is not None else 0.,
        'sender_marginal_entropy':float(marginal_bonus.detach()) if sender is not None else 0.,
        'receiver_entropy':float(choices.entropy().mean().detach()),'sampled_distinct_messages':distinct,'argmax_distinct_messages':greedy_distinct}
