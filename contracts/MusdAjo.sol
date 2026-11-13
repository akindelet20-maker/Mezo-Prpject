// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Ajo {
    function balanceOf(address account) external view returns (uint256);
}

/// @title MUSD Ajo — a testnet rotating savings-circle prototype
/// @notice Supports conventional ERC-20 tokens; not audited. No interest or yield.
/// @dev Creator is first in payout order. A complete cycle pays every member once.
contract MusdAjo {
    enum Status { Open, Active, Completed, Expired }

    struct Circle {
        string name;
        address token;
        address creator;
        uint256 contribution;
        uint256 memberLimit;
        uint256 roundDuration;
        uint256 deadline;
        uint256 round;
        uint256 paidCount;
        Status status;
        address[] members;
        mapping(address => bool) isMember;
        mapping(address => uint256) paidRound;
    }

    struct CircleView {
        string name;
        address token;
        address creator;
        uint256 contribution;
        uint256 memberLimit;
        uint256 roundDuration;
        uint256 deadline;
        uint256 round;
        uint256 paidCount;
        Status status;
        address[] members;
    }

    uint256 public nextCircleId;
    mapping(uint256 => Circle) private circles;
    uint256 private unlocked = 1;

    event CircleCreated(uint256 indexed circleId, address indexed creator, address indexed token, string name);
    event MemberJoined(uint256 indexed circleId, address indexed member, uint256 position);
    event CircleStarted(uint256 indexed circleId, uint256 deadline);
    event ContributionReceived(uint256 indexed circleId, uint256 indexed round, address indexed member, uint256 amount);
    event RoundPaid(uint256 indexed circleId, uint256 indexed round, address indexed recipient, uint256 amount);
    event CircleExpired(uint256 indexed circleId, uint256 indexed round);
    event RefundClaimed(uint256 indexed circleId, uint256 indexed round, address indexed member, uint256 amount);

    modifier nonReentrant() {
        require(unlocked == 1, "Reentrant call");
        unlocked = 2;
        _;
        unlocked = 1;
    }

    modifier exists(uint256 circleId) {
        require(circleId < nextCircleId, "Circle not found");
        _;
    }

    function createCircle(
        string calldata name,
        address token,
        uint256 contribution,
        uint256 memberLimit,
        uint256 roundDuration
    ) external returns (uint256 circleId) {
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Name: 1-64 bytes");
        require(token.code.length > 0, "Token must be a contract");
        require(contribution > 0, "Contribution is zero");
        require(memberLimit >= 2 && memberLimit <= 20, "Members: 2-20");
        require(roundDuration >= 60 && roundDuration <= 90 days, "Duration: 1 min-90 days");
        require(contribution <= type(uint256).max / memberLimit, "Pot overflow");

        circleId = nextCircleId++;
        Circle storage c = circles[circleId];
        c.name = name;
        c.token = token;
        c.creator = msg.sender;
        c.contribution = contribution;
        c.memberLimit = memberLimit;
        c.roundDuration = roundDuration;
        c.members.push(msg.sender);
        c.isMember[msg.sender] = true;
        emit CircleCreated(circleId, msg.sender, token, name);
        emit MemberJoined(circleId, msg.sender, 0);
    }

    function joinCircle(uint256 circleId) external exists(circleId) {
        Circle storage c = circles[circleId];
        require(c.status == Status.Open, "Circle is not open");
        require(!c.isMember[msg.sender], "Already a member");
        require(c.members.length < c.memberLimit, "Circle is full");
        c.isMember[msg.sender] = true;
        c.members.push(msg.sender);
        emit MemberJoined(circleId, msg.sender, c.members.length - 1);
        if (c.members.length == c.memberLimit) {
            c.status = Status.Active;
            c.deadline = block.timestamp + c.roundDuration;
            emit CircleStarted(circleId, c.deadline);
        }
    }

    function contribute(uint256 circleId) external nonReentrant exists(circleId) {
        Circle storage c = circles[circleId];
        require(c.status == Status.Active, "Circle is not active");
        require(block.timestamp <= c.deadline, "Round timed out");
        require(c.isMember[msg.sender], "Not a member");
        require(c.paidRound[msg.sender] != c.round + 1, "Already contributed");

        uint256 beforeBalance = IERC20Ajo(c.token).balanceOf(address(this));
        _safeTokenCall(c.token, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), c.contribution));
        require(IERC20Ajo(c.token).balanceOf(address(this)) == beforeBalance + c.contribution, "Unsupported transfer fee");
        c.paidRound[msg.sender] = c.round + 1;
        c.paidCount++;
        emit ContributionReceived(circleId, c.round, msg.sender, c.contribution);

        if (c.paidCount == c.memberLimit) {
            uint256 paidRound = c.round;
            address recipient = c.members[paidRound];
            uint256 pot = c.contribution * c.memberLimit;
            c.round++;
            c.paidCount = 0;
            if (c.round == c.memberLimit) {
                c.status = Status.Completed;
                c.deadline = 0;
            } else {
                c.deadline = block.timestamp + c.roundDuration;
            }
            _safeTokenCall(c.token, abi.encodeWithSignature("transfer(address,uint256)", recipient, pot));
            emit RoundPaid(circleId, paidRound, recipient, pot);
        }
    }

    function expireCircle(uint256 circleId) external exists(circleId) {
        _expire(circles[circleId], circleId);
    }

    /// @notice Returns only this member's payment in the current incomplete round.
    /// @dev Can expire a timed-out active circle and refund in one transaction.
    function claimRefund(uint256 circleId) external nonReentrant exists(circleId) {
        Circle storage c = circles[circleId];
        if (c.status == Status.Active && block.timestamp > c.deadline) _expire(c, circleId);
        require(c.status == Status.Expired, "Circle has not expired");
        require(c.paidRound[msg.sender] == c.round + 1, "No refundable contribution");
        c.paidRound[msg.sender] = 0;
        c.paidCount--;
        _safeTokenCall(c.token, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, c.contribution));
        emit RefundClaimed(circleId, c.round, msg.sender, c.contribution);
    }

    function getCircle(uint256 circleId) external view exists(circleId) returns (CircleView memory) {
        Circle storage c = circles[circleId];
        return CircleView(c.name, c.token, c.creator, c.contribution, c.memberLimit, c.roundDuration, c.deadline, c.round, c.paidCount, c.status, c.members);
    }

    function getMemberState(uint256 circleId, address member) external view exists(circleId)
        returns (bool isMember, bool hasContributed, bool canRefund)
    {
        Circle storage c = circles[circleId];
        isMember = c.isMember[member];
        hasContributed = c.paidRound[member] == c.round + 1;
        canRefund = hasContributed && (c.status == Status.Expired || (c.status == Status.Active && block.timestamp > c.deadline));
    }

    function _expire(Circle storage c, uint256 circleId) private {
        require(c.status == Status.Active, "Circle is not active");
        require(block.timestamp > c.deadline, "Round has not timed out");
        c.status = Status.Expired;
        emit CircleExpired(circleId, c.round);
    }

    function _safeTokenCall(address token, bytes memory data) private {
        (bool ok, bytes memory returned) = token.call(data);
        require(ok && (returned.length == 0 || abi.decode(returned, (bool))), "Token transfer failed");
    }
}
